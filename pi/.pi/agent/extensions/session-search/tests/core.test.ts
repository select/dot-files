import { strict as assert } from "node:assert"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { buildQuery, chunks, clean, documents, excerpt, parseSession, textContent, validateSessionFile, type Config } from "../core.ts"

const stamp = "2026-01-01T00:00:00Z"
export const fixture = (answer = "answer A") => [
	{ type: "session", id: "session-1", cwd: "/project", timestamp: stamp },
	{ type: "message", id: "user", parentId: null, timestamp: stamp, message: { role: "user", content: "question" } },
	{ type: "message", id: "a", parentId: "user", timestamp: stamp, message: { role: "assistant", content: [{ type: "text", text: answer }, { type: "thinking", thinking: "SECRET" }] } },
	{ type: "message", id: "b", parentId: "user", timestamp: stamp, message: { role: "assistant", content: [{ type: "text", text: "answer B" }] } },
	{ type: "message", id: "tool", parentId: "b", timestamp: stamp, message: { role: "toolResult", content: "SECRET tool output" } },
	{ type: "message", id: "system", parentId: "tool", timestamp: stamp, message: { role: "system", content: "SECRET system prompt" } },
	{ type: "compaction", id: "summary", parentId: "system", timestamp: stamp, summary: "branch summary" },
	{ type: "session_info", id: "name", parentId: "summary", name: "Named session" },
]
export const jsonl = (entries: unknown[]) => entries.map(e => JSON.stringify(e)).join("\n") + "\n"
export async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "pi-history-test-"))
	const config: Config = { sourceDir: join(root, "sessions"), stateDir: join(root, "state"),
		url: "http://127.0.0.1:19210", index: "pi-history-test", semanticIndex: "pi-history-neural-test", semanticStateDir: join(root, "neural-state"), apiKeyFile: join(root, "key") }
	await mkdir(config.sourceDir)
	return { root, config, file: join(config.sourceDir, "session.jsonl"), dispose: () => rm(root, { recursive: true, force: true }) }
}

test("extract only explicit text blocks and remove terminal escapes", () => {
	assert.equal(textContent([{ type: "text", text: "yes" }, { type: "toolCall", arguments: { secret: "no" } },
		{ type: "thinking", thinking: "no" }, { type: "image", data: "no" }]), "yes")
	assert.equal(textContent(" prompt "), "prompt")
	assert.equal(textContent(null), "")
	assert.equal(clean("\x1b[31mred\x1b[0m\x00"), "red")
})

test("chunks cover text exactly with bounded overlap", () => {
	const original = "0123456789".repeat(350)
	const parts = chunks(original)
	assert.equal(parts[0].slice(-160), parts[1].slice(0, 160))
	assert.equal(parts[0] + parts.slice(1).map(part => part.slice(160)).join(""), original)
	assert.equal(chunks("x".repeat(1000)).length, 1)
	assert.deepEqual(chunks(""), [])
	const emoji = "a".repeat(999) + "😀" + "b".repeat(1200)
	const unicodeParts = chunks(emoji)
	assert.ok(unicodeParts.every(part => part.isWellFormed()))
	assert.equal(unicodeParts[0] + unicodeParts.slice(1).map(part => Array.from(part).slice(160).join("")).join(""), emoji)
	assert.equal(clean("\ud800"), "�")
	assert.throws(() => chunks("bad", 5, 5))
})

test("parse JSONL metadata, malformed lines, branch structure and summaries", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture()) + '{"partial":')
		const session = await parseSession(w.file)
		assert.equal(session.id, "session-1")
		assert.equal(session.project, "/project")
		assert.equal(session.title, "Named session")
		assert.equal(session.invalidLines, 1)
		const docs = documents(session)
		assert.deepEqual(docs.map(d => d.source.body), ["question", "answer A", "answer B", "branch summary"])
		assert.equal(docs[1].source.line, 3)
		assert.equal(docs[1].id, documents(session)[1].id)
		assert.ok(!JSON.stringify(docs).includes("SECRET"))
		assert.deepEqual(excerpt(session, "a").map(e => e.text), ["question", "answer A"])
		assert.deepEqual(excerpt(session, "b").map(e => e.text), ["question", "answer B"])
		assert.deepEqual(excerpt(session, "summary").map(e => e.text), ["question", "answer B", "branch summary"])
		assert.throws(() => excerpt(session, "missing"))
	} finally { await w.dispose() }
})

test("file access refuses traversal and symlink escapes", async () => {
	const w = await workspace()
	try {
		await writeFile(w.file, jsonl(fixture()))
		const outside = join(w.root, "outside.jsonl")
		await writeFile(outside, "private")
		await symlink(outside, join(w.config.sourceDir, "link.jsonl"))
		assert.equal(await validateSessionFile(w.config, w.file), w.file)
		await assert.rejects(validateSessionFile(w.config, outside), /Only JSONL/)
		await assert.rejects(validateSessionFile(w.config, join(w.config.sourceDir, "link.jsonl")), /Only JSONL/)
	} finally { await w.dispose() }
})

test("keyword scope stays server-side while neural retrieval uses a bounded unfiltered pool", () => {
	const body = buildQuery({ query: "forgot credentials", mode: "hybrid", project: "/project", before: "2026-02-01", excludeSessionId: "current" })
	const encoded = JSON.stringify(body)
	assert.ok(encoded.includes('"semantic"'))
	assert.ok(encoded.includes('"hybrid"'))
	assert.equal(encoded.split('"project"').length - 1, 2) // keyword filter and a source-field name
	assert.equal(encoded.split('"current"').length - 1, 1)
	assert.ok(encoded.includes('"lt":"2026-02-01"'))
	assert.ok(encoded.includes('"operator":"and"'))
	const neural = buildQuery({ query: "forgot credentials", mode: "semantic", project: "/project", excludeSessionId: "current" })
	assert.equal(neural.size, 200)
	assert.deepEqual(neural.query, { semantic: { field: "body", query: "forgot credentials", k: 200 } })
	assert.throws(() => buildQuery({ query: " " }))
	assert.throws(() => buildQuery({ query: "ok", limit: 0 }))
	assert.throws(() => buildQuery({ query: "ok", before: "not-a-date" }))
})
