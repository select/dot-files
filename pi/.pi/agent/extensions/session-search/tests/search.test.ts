import { strict as assert } from "node:assert"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { Client, formatResults, search, type Config, type Passage } from "../core.ts"

const config: Config = { url: "http://127.0.0.1:19210", index: "pi-history-text-test", semanticIndex: "pi-history-neural-test",
	sourceDir: "/sessions", stateDir: "/state", semanticStateDir: "/neural-state", apiKeyFile: "/key" }
const doc = (entryId: string, sessionId = "old", part = 0): Passage => ({
	sessionId, sessionFile: `/sessions/${sessionId}.jsonl`, project: "/project", title: "title", entryId, parentId: null,
	line: 1, timestamp: "2026-01-01T00:00:00Z", role: "assistant", part, body: "historical reference",
})
const hit = (id: string, source: Passage) => ({ _id: id, _score: 0.9, _source: source })

class SearchClient extends Client {
	missing = false
	failNeural = false
	graph = { covered: true, stale: false, rebuilding: false, semantic_ann_blocked_by_passages: false }
	neuralHits = [hit("neural", doc("meaning")), hit("same", doc("exact"))]
	override async request<T>(path: string, _body?: unknown, options: Parameters<Client["request"]>[2] = {}): Promise<T> {
		options?.signal?.throwIfAborted()
		assert.ok(!path.endsWith("/_count") && !path.startsWith("/_cat/"), "coverage must not scan the corpus")
		if (path === `/${this.config.index},${this.config.semanticIndex}/_stats`) return { indices: {
			[this.config.index]: { primaries: { docs: { count: 10 } } },
			...(this.missing ? {} : { [this.config.semanticIndex]: { primaries: { docs: { count: 3 } } } }),
		} } as T
		const neural = path.includes(this.config.semanticIndex)
		if (neural && this.missing) throw new Error("XERJ HTTP 404: missing")
		if (neural && path.endsWith("/_stats")) return { indices: { [this.config.semanticIndex]: { primaries: { hnsw: this.graph } } } } as T
		if (neural && path.endsWith("/_search")) assert.ok(this.graph.covered && !this.graph.semantic_ann_blocked_by_passages, "unsafe vector scan must not run")
		if (neural && this.failNeural && path.endsWith("/_search")) throw new Error("XERJ HTTP 503: busy")
		const hits = neural ? this.neuralHits : [
			hit("current", doc("excluded", "current")), hit("same", doc("exact")), hit("other-part", doc("exact", "old", 1)),
		]
		return { took: 2, hits: { total: { value: hits.length }, hits } } as T
	}
}

test("hybrid weights keyword evidence, fuses shared IDs, deduplicates entries and excludes current session", async () => {
	const result = await search(new SearchClient(config), { query: "exact", excludeSessionId: "current" })
	assert.equal(result.hits[0].entryId, "exact")
	assert.equal(result.hits.length, 2)
	assert.ok(!result.hits.some(h => h.sessionId === "current"))
	assert.deepEqual(result.coverage, { keywordPassages: 10, neuralPassages: 3 })
	assert.equal(result.mode, "hybrid")
})

test("keyword search is still usable before the neural index exists", async () => {
	const client = new SearchClient(config)
	client.missing = true
	const result = await search(client, { query: "exact", mode: "hybrid", excludeSessionId: "current" })
	assert.equal(result.hits.length, 1)
	assert.equal(result.coverage.neuralPassages, 0)
	assert.ok(result.warnings[0].includes("Neural retrieval unavailable"))
})

test("hybrid reports neural errors instead of silently pretending retrieval succeeded", async () => {
	const client = new SearchClient(config)
	client.failNeural = true
	const result = await search(client, { query: "exact", excludeSessionId: "current" })
	assert.equal(result.hits[0].entryId, "exact")
	assert.ok(result.warnings[0].includes("503"))
	await assert.rejects(search(client, { query: "exact", mode: "semantic" }), /503/)
})

test("neural candidates cannot escape project, date or current-session scope", async () => {
	const client = new SearchClient(config)
	client.neuralHits = [
		hit("wrong-project", { ...doc("wrong-project"), project: "/other" }),
		hit("current", doc("current-entry", "current")),
		hit("too-new", { ...doc("too-new"), timestamp: "2026-03-01T00:00:00Z" }),
		hit("too-old", { ...doc("too-old"), timestamp: "2025-01-01T00:00:00Z" }),
		hit("invalid-date", { ...doc("invalid-date"), timestamp: "invalid" }),
		hit("valid", doc("valid")),
	]
	const result = await search(client, { query: "meaning", mode: "semantic", project: "/project",
		after: "2025-12-01", before: "2026-02-01", excludeSessionId: "current" })
	assert.deepEqual(result.hits.map(item => item.entryId), ["valid"])
	assert.ok(result.warnings.some(message => message.includes("200 global candidates")))
})

test("unready or passage-scored neural indices defer retrieval instead of scanning the corpus", async () => {
	for (const state of [{ covered: false }, { rebuilding: true }, { stale: true }, { semantic_ann_blocked_by_passages: true }]) {
		const client = new SearchClient(config)
		Object.assign(client.graph, state)
		const result = await search(client, { query: "exact", excludeSessionId: "current" })
		assert.equal(result.hits[0].entryId, "exact")
		assert.ok(result.warnings.some(message => message.includes("Neural retrieval unavailable")))
		await assert.rejects(search(client, { query: "exact", mode: "semantic" }), /Neural/)
	}
})

class SlowClient extends SearchClient {
	stalled = new Set<string>()
	aborted = new Set<string>()
	calls: string[] = []
	failCoverage = false
	override async request<T>(path: string, body?: unknown, options: Parameters<Client["request"]>[2] = {}): Promise<T> {
		this.calls.push(path)
		if (this.stalled.has(path)) {
			assert.ok(options.signal, "every search request must carry a deadline")
			try { await delay(5000, undefined, { signal: options.signal }) }
			catch (error) { this.aborted.add(path); throw error }
		}
		if (this.failCoverage && path === coveragePath) throw new Error("coverage endpoint unavailable")
		return super.request<T>(path, body, options)
	}
}

const keywordPath = `/${config.index}/_search`
const graphPath = `/${config.semanticIndex}/_stats`
const neuralPath = `/${config.semanticIndex}/_search`
const coveragePath = `/${config.index},${config.semanticIndex}/_stats`

test("slow neural retrieval returns keyword hits with a warning and aborts its request", async () => {
	const client = new SlowClient(config)
	client.stalled.add(neuralPath)
	const result = await search(client, { query: "exact", excludeSessionId: "current" }, undefined, 30)
	assert.deepEqual(result.hits.map(hit => hit.entryId), ["exact"])
	assert.ok(result.warnings.some(warning => warning.includes("Neural retrieval timed out")))
	assert.ok(client.aborted.has(neuralPath))
	assert.ok(result.tookMs >= 20 && result.tookMs < 1000, "elapsed time must include the timed-out work")
})

test("a stalled graph-readiness check cannot start an unsafe vector search", async () => {
	const client = new SlowClient(config)
	client.stalled.add(graphPath)
	const result = await search(client, { query: "exact", excludeSessionId: "current" }, undefined, 30)
	assert.equal(result.hits[0].entryId, "exact")
	assert.ok(result.warnings.some(warning => warning.includes("Neural retrieval timed out")))
	assert.ok(!client.calls.includes(neuralPath))
})

test("slow keyword retrieval preserves neural results in hybrid mode", async () => {
	const client = new SlowClient(config)
	client.stalled.add(keywordPath)
	const result = await search(client, { query: "exact" }, undefined, 30)
	assert.ok(result.hits.some(hit => hit.entryId === "meaning"))
	assert.ok(result.warnings.some(warning => warning.includes("Keyword retrieval timed out")))
	assert.ok(client.aborted.has(keywordPath))
})

test("slow or failed coverage does not discard successful keyword results or claim the index is empty", async () => {
	for (const slow of [true, false]) {
		const client = new SlowClient(config)
		if (slow) client.stalled.add(coveragePath)
		else client.failCoverage = true
		const result = await search(client, { query: "exact", mode: "keyword", excludeSessionId: "current" }, undefined, 30)
		assert.equal(result.hits[0].entryId, "exact")
		assert.deepEqual(result.coverage, { keywordPassages: -1, neuralPassages: -1 })
		assert.ok(result.warnings.some(warning => warning.includes("Index coverage unavailable")))
		assert.ok(formatResults(result).includes("unknown keyword passages; unknown neural passages"))
	}
})

test("keyword-only and semantic-only timeouts return explicit incomplete results, not a tool failure", async () => {
	for (const mode of ["keyword", "semantic"] as const) {
		const client = new SlowClient(config)
		const path = mode === "keyword" ? keywordPath : neuralPath
		client.stalled.add(path)
		const result = await search(client, { query: "exact", mode }, undefined, 30)
		assert.equal(result.hits.length, 0)
		assert.ok(result.warnings.some(warning => warning.includes("results are incomplete")))
		assert.ok(client.aborted.has(path))
	}
})

test("coverage uses targeted stats and retrieval carries server-side deadlines", async () => {
	class DeadlineClient extends SearchClient {
		override async request<T>(path: string, body?: unknown, options: Parameters<Client["request"]>[2] = {}): Promise<T> {
			if (path.endsWith("/_search")) {
				assert.equal((body as { timeout: string }).timeout, path === neuralPath ? "3000ms" : "8000ms")
				const response = await super.request<Record<string, unknown>>(path, body, options)
				return { ...response, timed_out: true } as T
			}
			return super.request<T>(path, body, options)
		}
	}
	const result = await search(new DeadlineClient(config), { query: "exact" })
	assert.deepEqual(result.coverage, { keywordPassages: 10, neuralPassages: 3 })
	assert.ok(result.hits.length > 0, "partial backend hits must be preserved")
	assert.ok(result.warnings.some(warning => warning.startsWith("Neural backend returned partial results")))
	assert.ok(result.warnings.some(warning => warning.startsWith("Keyword backend returned partial results")))
})

test("invalid search options are rejected before metadata or retrieval requests", async () => {
	const client = new SlowClient(config)
	for (const options of [{ query: " " }, { query: "exact", limit: 0 }, { query: "exact", before: "not-a-date" }]) {
		await assert.rejects(search(client, options))
	}
	assert.deepEqual(client.calls, [])
})

test("search cancellation is not swallowed by neural or metadata fallback", async () => {
	const client = new SlowClient(config)
	await assert.rejects(search(client, { query: "exact" }, AbortSignal.abort()))
	assert.deepEqual(client.calls, [])
	for (const path of [keywordPath, graphPath, neuralPath, coveragePath]) client.stalled.add(path)
	const abort = new AbortController()
	const reason = new Error("user cancelled search")
	const pending = search(client, { query: "exact" }, abort.signal, 1000)
	abort.abort(reason)
	await assert.rejects(pending, error => error === reason)
})
