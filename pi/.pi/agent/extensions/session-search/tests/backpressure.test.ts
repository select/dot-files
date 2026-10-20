import { strict as assert } from "node:assert"
import { test } from "node:test"
import { Client, XerjHttpError, type Config } from "../core.ts"
import { Indexer, SyncBackpressureError } from "../indexer.ts"

const config: Config = { url: "http://127.0.0.1:19210", index: "pi-history-text-test", semanticIndex: "pi-history-neural-test",
	sourceDir: "/sessions", stateDir: "/state", semanticStateDir: "/neural", apiKeyFile: "/key" }
const actions = [
	{ index: { _index: config.index, _id: "ok" } }, { body: "successful document" },
	{ index: { _index: config.index, _id: "retry" } }, { body: "rejected document" },
	{ delete: { _index: config.index, _id: "gone" } },
]
const success = (status = 201) => ({ status })
const rejected = (status = 429) => ({ status, error: { type: "engine_exception", reason: "memory circuit breaker" } })

class SequenceClient extends Client {
	calls: unknown[][] = []
	constructor(readonly outcomes: unknown[]) { super(config) }
	override async request<T>(_path: string, body?: unknown, options: Parameters<Client["request"]>[2] = {}): Promise<T> {
		options?.signal?.throwIfAborted()
		this.calls.push(String(body).trim().split("\n").map(line => JSON.parse(line)))
		const value = this.outcomes.shift()
		if (value instanceof Error) throw value
		assert.notEqual(value, undefined, "Unexpected extra bulk request")
		return value as T
	}
}
const worker = (client: SequenceClient) => new Indexer(config, client, false, { maxRetries: 2, baseDelayMs: 0 })

test("a 200 bulk with rejected items retries only the rejected action and its source", async () => {
	const client = new SequenceClient([
		{ errors: true, items: [{ index: success() }, { index: rejected() }, { delete: success(200) }] },
		{ errors: false, items: [{ index: success() }] },
	])
	await worker(client).bulk(actions)
	assert.equal(client.calls.length, 2)
	assert.deepEqual(client.calls[1], actions.slice(2, 4))
})

test("an HTTP 429 bulk body can also contain successful items that must not be replayed", async () => {
	const client = new SequenceClient([
		new XerjHttpError(429, { errors: true, items: [{ index: success() }, { index: success() }, { delete: rejected() }] }),
		{ errors: false, items: [{ delete: success(200) }] },
	])
	await worker(client).bulk(actions)
	assert.deepEqual(client.calls[1], [actions[4]])
})

test("a transient 503 without item results retries the idempotent request", async () => {
	const client = new SequenceClient([
		new XerjHttpError(503, "temporarily unavailable"),
		{ items: [{ index: success() }, { index: success() }, { delete: success(200) }] },
	])
	await worker(client).bulk(actions)
	assert.deepEqual(client.calls[1], actions)
})

test("permanent item errors are not retried", async () => {
	const client = new SequenceClient([{ items: [{ index: rejected(400) }] }])
	await assert.rejects(worker(client).bulk(actions.slice(0, 2)), /HTTP 400/)
	assert.equal(client.calls.length, 1)
})

test("permanent HTTP failures are not retried", async () => {
	const client = new SequenceClient([new XerjHttpError(403, "not authorized")])
	await assert.rejects(worker(client).bulk(actions), /403/)
	assert.equal(client.calls.length, 1)
})

test("an already-absent delete is an idempotent success", async () => {
	const client = new SequenceClient([{ items: [{ delete: { status: 404 } }] }])
	await worker(client).bulk([actions[4]])
	assert.equal(client.calls.length, 1)
})

test("retry budget is bounded and exhaustion reports deferred sync", async () => {
	const client = new SequenceClient(Array.from({ length: 3 }, () => new XerjHttpError(429, "busy")))
	await assert.rejects(worker(client).bulk(actions), SyncBackpressureError)
	assert.equal(client.calls.length, 3)
})

test("cancellation interrupts retry backoff without another write", async () => {
	const client = new SequenceClient([new XerjHttpError(429, "busy")])
	const abort = new AbortController()
	const pending = new Indexer(config, client, false, { baseDelayMs: 1000 }).bulk(actions, abort.signal)
	queueMicrotask(() => abort.abort())
	await assert.rejects(pending, { name: "AbortError" })
	assert.equal(client.calls.length, 1)
})

test("incomplete item responses fail safely instead of advancing the pending checkpoint", async () => {
	const client = new SequenceClient([{ items: [] }])
	await assert.rejects(worker(client).bulk(actions), /incomplete bulk response/)
	assert.equal(client.calls.length, 1)
})

test("HTTP errors retain structured results but display only one concise reason", () => {
	const body = { errors: true, items: Array.from({ length: 200 }, () => ({ delete: rejected() })) }
	const error = new XerjHttpError(429, body)
	assert.equal(error.body, body)
	assert.equal(error.status, 429)
	assert.ok(error.message.includes("memory circuit breaker"))
	assert.ok(error.message.length < 400)
})
