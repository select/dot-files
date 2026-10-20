import { strict as assert } from "node:assert"
import { readFile, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { Client, XerjHttpError, type Config, type Passage } from "../core.ts"
import { acquireLock, Indexer, SyncBackpressureError, SyncBusyError } from "../indexer.ts"
import { fixture, jsonl, workspace } from "./core.test.ts"

class FakeClient extends Client {
	exists = false
	docs = new Map<string, Passage>()
	failNextBulk = false
	busyAttempts = 0
	bulkSizes: number[] = []
	constructor(config: Config) { super(config) }
	override async request<T>(path: string, body?: unknown, options: Parameters<Client["request"]>[2] = {}): Promise<T> {
		options?.signal?.throwIfAborted()
		if (path.endsWith("/_mapping")) {
			if (!this.exists) throw new Error("XERJ HTTP 404: index missing")
			return {} as T
		}
		if (path === `/${this.config.index}` && options?.method === "PUT") { this.exists = true; return {} as T }
		if (path === "/_bulk") {
			if (this.busyAttempts > 0) { this.busyAttempts--; throw new XerjHttpError(429, "memory breaker") }
			const lines = String(body).trim().split("\n").map(line => JSON.parse(line)) as Record<string, unknown>[]
			const items: Record<string, { status: number }>[] = []
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].index) {
					const action = lines[i].index as { _id: string }
					this.docs.set(action._id, lines[++i] as unknown as Passage)
					items.push({ index: { status: 201 } })
					continue
				}
				const action = lines[i].delete as { _id: string }
				this.docs.delete(action._id)
				items.push({ delete: { status: 200 } })
			}
			this.bulkSizes.push(items.length)
			if (this.failNextBulk) { this.failNextBulk = false; throw new Error("Simulated failure after server write") }
			return { errors: false, items } as T
		}
		return {} as T
	}
}

test("sync is incremental, idempotent and reconciles edits and deletions", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture("a".repeat(3000))))
		const client = new FakeClient(w.config)
		const indexer = new Indexer(w.config, client)
		const initial = await indexer.sync()
		assert.equal(initial.changed, 1)
		assert.equal(client.docs.size, 7)
		assert.equal((await indexer.sync()).changed, 0)
		assert.equal(client.docs.size, 7)
		await writeFile(w.file, jsonl(fixture("short answer")))
		assert.equal((await indexer.sync()).changed, 1)
		assert.equal(client.docs.size, 4)
		assert.ok([...client.docs.values()].some(doc => doc.body === "short answer"))
		await unlink(w.file)
		assert.equal((await indexer.sync()).deleted, 1)
		assert.equal(client.docs.size, 0)
	} finally { await w.dispose() }
})

test("failed writes recover without orphan passages, including when source is deleted", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture("a".repeat(3000))))
		const client = new FakeClient(w.config)
		const indexer = new Indexer(w.config, client)
		client.failNextBulk = true
		await assert.rejects(indexer.sync(), /Simulated failure/)
		assert.ok(client.docs.size > 0)
		await unlink(w.file)
		await indexer.sync()
		assert.equal(client.docs.size, 0)
		await assert.rejects(readFile(join(w.config.stateDir, "pending.json")), { code: "ENOENT" })
	} finally { await w.dispose() }
})

test("current-file sync does not delete other sessions", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture()))
		const other = join(w.config.sourceDir, "other.jsonl")
		await writeFile(other, jsonl(fixture()))
		const client = new FakeClient(w.config)
		const indexer = new Indexer(w.config, client)
		await indexer.sync()
		assert.equal(client.docs.size, 8)
		await writeFile(w.file, jsonl(fixture("new answer")))
		assert.equal((await indexer.sync({ file: w.file })).changed, 1)
		assert.equal(client.docs.size, 8)
	} finally { await w.dispose() }
})

test("neural writes stay within one backend passage and four-document batches", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture("🙂".repeat(3000))))
		const client = new FakeClient(w.config)
		await new Indexer(w.config, client, true).sync()
		assert.ok(client.docs.size > 4)
		assert.ok([...client.docs.values()].every(doc => Array.from(doc.body).length <= 512))
		assert.ok(client.bulkSizes.every(size => size <= 4))
	} finally { await w.dispose() }
})

test("exhausted backpressure preserves pending work and releases the sync lock", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture()))
		const client = new FakeClient(w.config)
		client.busyAttempts = 2
		const indexer = new Indexer(w.config, client, false, { maxRetries: 1, baseDelayMs: 0 })
		await assert.rejects(indexer.sync(), SyncBackpressureError)
		assert.ok(JSON.parse(await readFile(join(w.config.stateDir, "pending.json"), "utf8")).ids.length > 0)
		await (await acquireLock(w.config.stateDir))()
		assert.equal((await indexer.sync()).changed, 1)
		await assert.rejects(readFile(join(w.config.stateDir, "pending.json")), { code: "ENOENT" })
	} finally { await w.dispose() }
})

test("exclusive lock prevents overlapping writers and can be released", async () => {
	const w = await workspace()
	try {
		const release = await acquireLock(w.config.stateDir)
		await assert.rejects(acquireLock(w.config.stateDir), SyncBusyError)
		await release()
		await (await acquireLock(w.config.stateDir))()
	} finally { await w.dispose() }
})

test("cancelled sync releases its lock", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture()))
		const indexer = new Indexer(w.config, new FakeClient(w.config))
		await assert.rejects(indexer.sync({ signal: AbortSignal.abort() }))
		await (await acquireLock(w.config.stateDir))()
	} finally { await w.dispose() }
})
