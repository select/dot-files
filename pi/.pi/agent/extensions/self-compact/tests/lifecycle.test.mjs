import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

// Real Pi scheduler/print shutdown; only the model transport is fake. No credentials or network.
const host = process.env.PI_SELF_COMPACT_HOST
const api = host ? await import(pathToFileURL(join(host, "dist/index.js"))) : undefined
const loader = host ? await import(pathToFileURL(join(host, "dist/core/extensions/loader.js"))) : undefined
const ai = host ? await import(pathToFileURL(join(host, "../pi-ai/dist/index.js"))) : undefined
const source = process.env.PI_SELF_COMPACT_SOURCE ?? dirname(dirname(fileURLToPath(import.meta.url)))
const options = { skip: !host, timeout: 30000 }
const note = "Goal: finish task\nDONE: verified first step ✓\nNEXT ACTION: finish the second step\n"
const usage = { input: 1000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 1010,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const model = { provider: "test", id: "lifecycle", api: "anthropic-messages", name: "Test", contextWindow: 200000,
	maxTokens: 8192, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const assistant = (content, stopReason = "stop") => ({ role: "assistant", content, stopReason, usage,
	api: model.api, provider: model.provider, model: model.id, timestamp: Date.now() })

async function setup({ summaryFailures = 0, savedStatus, onSummary, cycles = 1 } = {}) {
	const root = mkdtempSync(join(tmpdir(), "sc-lifecycle-"))
	const directory = join(root, "extensions/self-compact")
	mkdirSync(join(root, ".pi"))
	writeFileSync(join(root, ".pi/settings.json"), JSON.stringify({
		compaction: { enabled: false, keepRecentTokens: 20000 }, retry: { enabled: false },
	}))
	cpSync(source, directory, { recursive: true, filter: path => !path.includes("node_modules") && !path.includes("/tests") })
	symlinkSync(join(source, "node_modules"), join(directory, "node_modules"), "dir")
	writeFileSync(join(root, "extensions/self-compact.yaml"), 'defaults: { softAt: "60%", at: "75%", buffer: "10%" }\n')
	const loaded = await loader.loadExtensions([join(directory, "index.ts")], root)
	assert.deepEqual(loaded.errors, [])
	const resourceLoader = {
		getExtensions: () => loaded,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => "Complete the test task.", getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
		extendResources: () => {}, reload: async () => {},
	}
	const manager = api.SessionManager.inMemory(root)
	for (let i = 0; i < 4; i++) {
		manager.appendMessage({ role: "user", content: "History ".repeat(15000), timestamp: Date.now() })
		manager.appendMessage(assistant([{ type: "text", text: `Completed step ${i}` }]))
	}
	if (savedStatus) manager.appendCustomEntry("self-compact-state", { version: 1, cycle: 0, locked: true,
		handoff: { id: "interrupted", note, status: savedStatus, attempts: 1, savedAt: Date.now() } })
	const runtime = await api.ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null,
		modelsStorePath: join(root, "models-cache.json"), refreshOnCreate: false, allowModelNetwork: false })
	runtime.hasConfiguredAuth = () => true
	runtime.getAuth = async () => ({ auth: { apiKey: "fake-test-only" } })
	const requests = []
	const timeline = []
	let summaryCalls = 0
	runtime.streamSimple = (_model, context) => {
		requests.push(structuredClone(context))
		const content = requests.length <= cycles && !savedStatus
			? [...(requests.length > 1 ? [{ type: "text", text: "Verified more work. ".repeat(6000) }] : []),
				{ type: "toolCall", id: `compact-${requests.length}`, name: "self_compact", arguments: { note_to_self: note } }]
			: [{ type: "text", text: "RESUMED_AND_FINISHED" }]
		const message = assistant(content, content.some(block => block.type === "toolCall") ? "toolUse" : "stop")
		const stream = ai.createAssistantMessageEventStream()
		stream.push({ type: "done", reason: message.stopReason, message })
		stream.end(message)
		return stream
	}
	runtime.complete = async (_model, _context, { signal }) => {
		summaryCalls++
		timeline.push("summary-start")
		onSummary?.(session, signal)
		await delay(30, undefined, { signal })
		if (summaryCalls <= summaryFailures) throw new Error("synthetic summary failure")
		timeline.push("summary-end")
		return assistant([{ type: "text", text: "## Goal\nFinish the task.\n## Next Steps\nFinish the second step." }])
	}
	const { session } = await api.createAgentSession({ cwd: root, agentDir: root, model, modelRuntime: runtime,
		resourceLoader, sessionManager: manager, thinkingLevel: "off", tools: ["self_compact", "view_context"],
		settingsManager: api.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }) })
	const errors = []
	session.extensionRunner.onError(error => errors.push(error))
	session.subscribe(event => timeline.push(event.type))
	const runtimeHost = new api.AgentSessionRuntime(session, {}, async () => { throw new Error("Unexpected replacement") })
	const dispose = runtimeHost.dispose.bind(runtimeHost)
	runtimeHost.dispose = async () => { timeline.push("dispose"); await dispose() }
	return { session, manager, requests, timeline, errors, runtimeHost, get summaryCalls() { return summaryCalls } }
}

function verifyHandoff(run) {
	assert.deepEqual(run.errors, [])
	assert.equal(run.requests.length, 2, JSON.stringify(run.timeline))
	const branch = run.manager.getBranch()
	assert.equal(branch.filter(entry => entry.type === "compaction").length, 1)
	const handoffs = branch.filter(entry => entry.type === "custom_message" && entry.customType === "self-compact-handoff")
	assert.equal(handoffs.length, 1)
	assert.equal(handoffs[0].content, note)
	assert.ok(run.requests[1].messages.some(message => message.role === "user" &&
		(typeof message.content === "string" ? message.content === note :
			message.content.some(block => block.type === "text" && block.text === note))))
	assert.ok(!run.requests[1].messages.some(message => JSON.stringify(message).includes("Completed step 0")))
	assert.ok(run.timeline.indexOf("summary-end") < run.timeline.indexOf("agent_settled"))
	assert.equal(run.session.state.messages.at(-1).content[0].text, "RESUMED_AND_FINISHED")
	const state = branch.filter(entry => entry.type === "custom" && entry.customType === "self-compact-state").at(-1).data
	assert.equal(state.locked, false)
	assert.equal(state.handoff.status, "done")
}

for (const mode of ["text", "json"]) {
	test(`${mode} print waits for compaction and resumes the verbatim note before shutdown`, options, async () => {
		const run = await setup()
		const code = await api.runPrintMode(run.runtimeHost, { mode, initialMessage: "Finish both steps." })
		assert.equal(code, 0)
		verifyHandoff(run)
		assert.ok(run.timeline.indexOf("summary-end") < run.timeline.indexOf("dispose"))
	})
}

test("interactive SDK prompt waits for the same handoff without an idle timer", options, async () => {
	const run = await setup()
	try {
		await run.session.bindExtensions({ mode: "tui" })
		await run.session.prompt("Finish both steps.")
		verifyHandoff(run)
	} finally { await run.runtimeHost.dispose() }
})

test("print awaits retries and delivers the handoff once after a failed summary attempt", options, async () => {
	const run = await setup({ summaryFailures: 2 })
	await api.runPrintMode(run.runtimeHost, { mode: "text", initialMessage: "Finish both steps." })
	verifyHandoff(run)
	assert.ok(run.summaryCalls > 2)
})

test("exhausted summary retries keep the note locked without a detached continuation", options, async () => {
	const run = await setup({ summaryFailures: Infinity })
	await api.runPrintMode(run.runtimeHost, { mode: "text", initialMessage: "Finish both steps." })
	assert.deepEqual(run.errors, [])
	assert.equal(run.requests.length, 1)
	assert.equal(run.summaryCalls, 6)
	assert.equal(run.manager.getBranch().some(entry => entry.type === "compaction"), false)
	const state = run.manager.getBranch().filter(entry => entry.customType === "self-compact-state").at(-1).data
	assert.equal(state.handoff.status, "failed")
	assert.equal(state.handoff.note, note)
	assert.equal(state.handoff.attempts, 3)
	assert.equal(state.locked, true)
})

test("abort cancels the awaited summary, keeps its note, and does not resume", options, async () => {
	const run = await setup({ onSummary: session => { void session.abort() } })
	await api.runPrintMode(run.runtimeHost, { mode: "text", initialMessage: "Finish both steps." })
	assert.deepEqual(run.errors, [])
	assert.equal(run.requests.length, 1)
	assert.equal(run.summaryCalls, 1)
	const state = run.manager.getBranch().filter(entry => entry.customType === "self-compact-state").at(-1).data
	assert.equal(state.handoff.note, note)
	assert.equal(state.handoff.status, "failed")
	assert.equal(state.locked, true)
	assert.equal(run.manager.getBranch().some(entry => entry.type === "compaction"), false)
})

test("a reloaded interrupted handoff is completed within the new print invocation", options, async () => {
	const run = await setup({ savedStatus: "compacting" })
	await api.runPrintMode(run.runtimeHost, { mode: "text", initialMessage: "Resume unfinished work." })
	verifyHandoff(run)
})

test("two self-compaction cycles finish in one print invocation with no duplicate handoff", options, async () => {
	const run = await setup({ cycles: 2 })
	await api.runPrintMode(run.runtimeHost, { mode: "text", initialMessage: "Finish both steps." })
	assert.deepEqual(run.errors, [])
	assert.equal(run.requests.length, 3)
	const branch = run.manager.getBranch()
	assert.equal(branch.filter(entry => entry.type === "compaction").length, 2)
	assert.equal(branch.filter(entry => entry.customType === "self-compact-handoff").length, 2)
	const state = branch.filter(entry => entry.customType === "self-compact-state").at(-1).data
	assert.equal(state.cycle, 2)
	assert.equal(state.handoff.status, "done")
	assert.equal(state.locked, false)
})
