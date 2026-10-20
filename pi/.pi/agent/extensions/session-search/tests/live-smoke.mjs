// Explicit integration test: requires the local backend and seeded Kafka session.
// Does not call a language model or modify session transcripts.
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent"

const temporary = await mkdtemp(join(tmpdir(), "pi-history-load-test-"))
try {
	const loader = new DefaultResourceLoader({ cwd: temporary, agentDir: temporary,
		settingsManager: SettingsManager.inMemory({}),
		additionalExtensionPaths: [resolve(import.meta.dirname, "../index.ts")],
		noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true })
	await loader.reload()
	const loaded = loader.getExtensions()
	assert.deepEqual(loaded.errors, [])
	assert.deepEqual(loaded.warnings || [], [])
	assert.equal(loaded.extensions.length, 1)
	const extension = loaded.extensions[0]
	assert.equal(extension.commands.size, 3)
	const find = extension.tools.get("search_sessions").definition
	const read = extension.tools.get("read_session_excerpt").definition
	const context = { sessionManager: { getSessionId: () => "smoke-test" } }
	console.error("Live check: keyword search")
	const keyword = await find.execute("smoke-keyword", { query: "EN-6382", mode: "keyword", before: "2026-10-19", limit: 3 }, AbortSignal.timeout(30000), undefined, context)
	assert.ok(keyword.structuredContent.hits.length > 0)
	assert.ok(keyword.structuredContent.coverage.keywordPassages > 40000)
	const hit = keyword.structuredContent.hits[0]
	console.error("Live check: current-session exclusion")
	const excluded = await find.execute("smoke-exclusion", { query: "EN-6382", mode: "keyword", limit: 5 }, undefined, undefined,
		{ sessionManager: { getSessionId: () => hit.sessionId } })
	assert.ok(excluded.structuredContent.hits.every(other => other.sessionId !== hit.sessionId))
	const reference = await read.execute("smoke-reference", { sessionFile: hit.sessionFile, entryId: hit.entryId })
	assert.ok(reference.content[0].text.includes("EN-6382"))
	assert.ok(reference.content[0].text.length <= 12000)
	console.error("Live check: scoped semantic search")
	const semantic = await find.execute("smoke-semantic", {
		query: "a German public domain tale about a man waiting outside a guarded doorway", mode: "semantic",
		project: join(process.env.HOME, "Dev/kafka"), before: "2026-10-19", limit: 3,
	}, AbortSignal.timeout(30000), undefined, context)
	assert.ok(semantic.structuredContent.hits.length > 0)
	assert.ok(semantic.structuredContent.hits.every(match => match.project === join(process.env.HOME, "Dev/kafka")))
	console.log(JSON.stringify({ loader: "passed", tools: [...extension.tools.keys()], commands: [...extension.commands.keys()],
		keywordExcerpts: keyword.structuredContent.hits.length, currentSessionExcluded: true, sourceRead: "passed",
		semanticExcerpts: semantic.structuredContent.hits.length, coverage: keyword.structuredContent.coverage }, null, 2))
} finally {
	await rm(temporary, { recursive: true, force: true })
}
