import { strict as assert } from "node:assert"
import { test } from "node:test"
import { Client, search, type Config, type Passage } from "../core.ts"

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
		assert.ok(!path.endsWith("/_count"), "coverage must not scan the corpus")
		if (path.startsWith("/_cat/indices")) return [
			{ index: this.config.index, "docs.count": "10" },
			...(this.missing ? [] : [{ index: this.config.semanticIndex, "docs.count": "3" }]),
		] as T
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

test("search cancellation is not swallowed by neural fallback", async () => {
	await assert.rejects(search(new SearchClient(config), { query: "exact" }, AbortSignal.abort()))
})
