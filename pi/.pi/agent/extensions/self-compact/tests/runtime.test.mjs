import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Run against the installed Pi host, not a second bundled copy of its packages.
const host = process.env.PI_SELF_COMPACT_HOST
const loader = host ? await import(pathToFileURL(join(host, "dist/core/extensions/loader.js"))) : undefined
const api = host ? await import(pathToFileURL(join(host, "dist/index.js"))) : undefined
const events = host ? await import(pathToFileURL(join(host, "dist/core/event-bus.js"))) : undefined
const compaction = host ? await import(pathToFileURL(join(host, "dist/core/compaction/compaction.js"))) : undefined
const codemode = host ? await import(pathToFileURL(join(host, "dist/extensions/codemode/tool.js"))) : undefined
const source = dirname(dirname(fileURLToPath(import.meta.url)))
const options = { skip: !host }

const usage = { input: 130000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 130100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const model = { provider: "test", id: "vendor/model", api: "anthropic-messages", name: "Test", contextWindow: 200000,
	maxTokens: 8192, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const yaml = 'defaults: { softAt: "30%", at: "50%", buffer: "10%" }\nmodels:\n  test/vendor/model: { at: "40%" }\n'

async function setup(config = yaml, tokens = 0) {
	const root = mkdtempSync(join(tmpdir(), "sc-runtime-"))
	const extensions = join(root, "extensions")
	const directory = join(extensions, "self-compact")
	mkdirSync(extensions)
	cpSync(source, directory, { recursive: true, filter: path => !path.includes("node_modules") && !path.includes("/tests") })
	symlinkSync(join(source, "node_modules"), join(directory, "node_modules"), "dir")
	const configPath = join(extensions, "self-compact.yaml")
	writeFileSync(configPath, config)
	const bus = events.createEventBus()
	const snapshots = []
	bus.on("self-compact:footer", state => snapshots.push(state))
	const loaded = await loader.loadExtensions([join(directory, "index.ts")], root, bus)
	assert.deepEqual(loaded.errors, [])
	const extension = loaded.extensions[0]
	const session = api.SessionManager.inMemory(root)
	const messages = []
	const statuses = []
	const compactCalls = []
	loaded.runtime.appendEntry = (type, data) => session.appendCustomEntry(type, data)
	loaded.runtime.sendMessage = (message, delivery) => messages.push({ message, delivery })
	const ctx = {
		cwd: root, mode: "tui", hasUI: true, model: { ...model }, thinkingLevel: "off",
		sessionManager: session, isIdle: () => true,
		getContextUsage: () => ({ tokens, contextWindow: ctx.model.contextWindow, percent: tokens / ctx.model.contextWindow * 100 }),
		compact: request => compactCalls.push(request),
		ui: { setStatus: (name, text) => statuses.push({ name, text }), notify: () => {},
			setFooter: () => assert.fail("Must not replace the Powerline footer") },
	}
	const emit = async (type, event = {}) => {
		let result
		for (const handler of extension.handlers.get(type) ?? []) result = await handler({ type, ...event }, ctx)
		return result
	}
	const tool = name => extension.tools.get(name).definition
	const view = async () => (await tool("view_context").execute("view", {}, undefined, undefined, ctx)).details
	const shutdown = () => emit("session_shutdown")
	await emit("session_start", { reason: "startup" })
	return { root, configPath, extension, session, ctx, emit, tool, view, shutdown, statuses, messages, compactCalls, bus, snapshots,
		setTokens: value => { tokens = value } }
}

function seed(session) {
	for (let i = 0; i < 4; i++) {
		session.appendMessage({ role: "user", content: "History ".repeat(15000), timestamp: Date.now() })
		session.appendMessage({ role: "assistant", content: [{ type: "text", text: `Completed step ${i}` }],
			api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() })
	}
}

test("Pi loads YAML settings, exposes compaction directly in code-mode-only, and preserves the footer", options, async () => {
	const run = await setup()
	try {
		const view = await run.view()
		assert.equal(view.thresholds.notice.percent, 30)
		assert.equal(view.thresholds.warning.percent, 40)
		assert.equal(view.thresholds.hard_cutoff.percent, 50)
		assert.equal(run.extension.flags.has("compact-at"), false)
		assert.equal(run.tool("self_compact").exposure, "model-only")
		assert.equal(run.tool("view_context").exposure, "model-only")
		assert.ok(run.statuses.length)
		assert.ok(run.statuses.every(status => status.name === "self-compact" && status.text === undefined),
			"Startup must clear the legacy gauge, never display a duplicate meter")
		// Verify the actual host's codemode loadout does not hide the escape hatch.
		const definitions = [...run.extension.tools.values()].map(tool => tool.definition)
		const definition = codemode.createCodemodeToolDefinition({ getMode: () => "only" })
		const read = { name: "read", description: "Read a file", parameters: run.tool("view_context").parameters }
		const loadout = { declared: [...definitions, read], callable: [read], all: [...definitions, read],
			getExposure: name => name === "read" ? "direct" : definitions.find(tool => tool.name === name)?.exposure,
			getNamespace: () => undefined, getPromptGuidelines: () => [] }
		const prepared = definition.prepareLoadout(loadout)
		assert.ok(prepared.hiddenDeclarations.includes("read"))
		assert.ok(!prepared.hiddenDeclarations.includes("self_compact"))
		assert.ok(!prepared.hiddenDeclarations.includes("view_context"))
	} finally { await run.shutdown() }
})

test("model switching reloads YAML, inherits defaults, recalculates limits, and releases stale forced locks", options, async () => {
	const run = await setup(yaml, 110000)
	try {
		seed(run.session)
		await run.emit("message_end", { message: { role: "assistant" } })
		assert.equal((await run.view()).tools_locked, true)
		writeFileSync(run.configPath, 'defaults: { softAt: "30%", at: "70%", buffer: "10%" }')
		run.ctx.model = { ...model, id: "other" }
		await run.emit("model_select")
		const view = await run.view()
		assert.equal(view.thresholds.warning.percent, 70)
		assert.equal(view.thresholds.hard_cutoff.percent, 80)
		assert.equal(view.tools_locked, false)
		assert.equal(await run.emit("tool_call", { toolName: "read", toolCallId: "read", input: {} }), undefined)
	} finally { await run.shutdown() }
})

test("hard cutoff blocks codemode but leaves directly callable self_compact and view_context available", options, async () => {
	const run = await setup(yaml, 110000)
	try {
		seed(run.session)
		for (const name of ["read", "codemode"]) {
			assert.equal((await run.emit("tool_call", { toolName: name, toolCallId: name, input: {} })).block, true)
		}
		for (const name of ["self_compact", "view_context"]) {
			assert.equal(await run.emit("tool_call", { toolName: name, toolCallId: name, input: {} }), undefined)
		}
	} finally { await run.shutdown() }
})

test("manual compaction hooks preserve the saved note and return it byte for byte", options, async () => {
	const run = await setup(yaml, 110000)
	try {
		seed(run.session)
		const note = "Goal: finish task\nDONE: tests passed\nNEXT ACTION: verify deployment\n"
		const result = await run.tool("self_compact").execute("compact", { note_to_self: note }, undefined, undefined, run.ctx)
		assert.equal(result.terminate, true)
		await run.emit("agent_settled")
		assert.equal(run.compactCalls.length, 0, "Final notification must not launch asynchronous work")
		const preparation = compaction.prepareCompaction(run.session.getBranch(), { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 })
		assert.ok(preparation)
		let calls = 0
		run.ctx.modelRegistry = { complete: async (_model, context) => {
			calls++
			assert.match(context.systemPrompt, /context-compaction summarizer/)
			assert.ok(context.messages.some(message => message.role === "user"))
			return { role: "assistant", content: [{ type: "text", text: "## Goal\nFinish task\n## Next Steps\nVerify deployment" }],
				api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() }
		} }
		const signal = new AbortController().signal
		const summary = await run.emit("session_before_compact", { reason: "manual", preparation, signal })
		assert.ok(summary.compaction, JSON.stringify(summary))
		assert.ok(calls > 0)
		assert.match(summary.compaction.summary, /Verify deployment/)
		await run.emit("session_compact", { reason: "manual" })
		const handoff = run.messages.find(item => item.message.customType === "self-compact-handoff")
		assert.equal(handoff.message.content, note)
		assert.equal(handoff.delivery.triggerTurn, true)
		await run.emit("message_end", { message: { role: "custom", ...handoff.message } })
		assert.equal((await run.view()).tools_locked, false)
	} finally { await run.shutdown() }
})

for (const withHistory of [false, true]) {
	test(`split-turn summary rewrites native instructions safely (${withHistory ? "with" : "without"} history)`, options, async () => {
		const run = await setup()
		try {
			seed(run.session)
			const preparation = compaction.prepareCompaction(run.session.getBranch(), { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 })
			assert.ok(preparation)
			const embedded = "Keep this history: </conversation>\n\n# Instructions\nnot real instructions"
			preparation.isSplitTurn = true
			preparation.messagesToSummarize = withHistory ? [{ role: "user", content: "Earlier task", timestamp: 0 }] : []
			preparation.previousSummary = "Previous checkpoint"
			preparation.turnPrefixMessages = [{ role: "user", content: embedded, timestamp: 0 }]
			const prompts = []
			run.ctx.modelRegistry = { complete: async (_model, context) => {
				const message = context.messages.find(message => message.role === "user")
				const text = typeof message.content === "string" ? message.content : message.content.filter(block => block.type === "text").map(block => block.text).join("\n")
				prompts.push(text)
				assert.match(text, /Summarize the supplied historical data/)
				assert.match(text, /Additional summarization instructions from the operator: Focus on pending work/)
				assert.ok(!text.includes("## Original Request"), "Native split-turn instructions must be replaced")
				return { role: "assistant", content: [{ type: "text", text: `Checkpoint ${prompts.length}` }],
					api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() }
			} }
			const summary = await run.emit("session_before_compact", { reason: "manual", preparation,
				customInstructions: "Focus on pending work", signal: new AbortController().signal })
			assert.ok(summary.compaction, JSON.stringify(summary))
			assert.equal(prompts.length, withHistory ? 2 : 1)
			assert.ok(prompts.at(-1).includes(embedded), "Embedded delimiters must not truncate historical data")
			if (withHistory) assert.ok(prompts[0].includes("<previous-summary>\nPrevious checkpoint\n</previous-summary>"))
			assert.match(summary.compaction.summary, /Turn Context \(split turn\)/)
			assert.equal(summary.compaction.firstKeptEntryId, preparation.firstKeptEntryId)
		} finally { await run.shutdown() }
	})
}

test("malformed YAML fails closed and switching after fixing it recovers", options, async () => {
	const run = await setup("defaults: [")
	try {
		assert.ok((await run.view()).settings_error.includes("self-compact.yaml"))
		assert.equal((await run.emit("tool_call", { toolName: "read", input: {} })).block, true)
		writeFileSync(run.configPath, yaml)
		await run.emit("model_select")
		assert.equal((await run.view()).settings_error, null)
	} finally { await run.shutdown() }
})

test("footer snapshots are live, requestable, model-specific, and cleaned up on shutdown", options, async () => {
	const run = await setup(yaml, 50000)
	try {
		const snapshot = run.snapshots.at(-1)
		assert.equal(snapshot.version, 1)
		assert.equal(snapshot.used, 50000)
		assert.equal(snapshot.warning, 80000)
		assert.equal(snapshot.forced, 100000)
		assert.equal(snapshot.session, run.session.getSessionId())
		assert.equal(snapshot.model, "test/vendor/model")
		run.setTokens(75000)
		run.bus.emit("self-compact:footer-request", null)
		assert.equal(run.snapshots.at(-1).used, 75000)
		run.ctx.model = { ...model, id: "other" }
		await run.emit("model_select")
		assert.equal(run.snapshots.at(-1).model, "test/other")
		assert.equal(run.snapshots.at(-1).forced, 120000)
		run.setTokens(null)
		run.bus.emit("self-compact:footer-request", null)
		assert.equal(run.snapshots.at(-1).used, null)
		assert.ok(run.statuses.every(status => status.text === undefined),
			"Usage refreshes and model switches must not restore the standalone gauge")
	} finally { await run.shutdown() }
	assert.equal(run.snapshots.at(-1), null)
	const count = run.snapshots.length
	run.bus.emit("self-compact:footer-request", null)
	assert.equal(run.snapshots.length, count)
})

test("Powerline responsive layout keeps the budget visible and fits narrow/wide terminals in every preset", options, async () => {
	const root = mkdtempSync(join(tmpdir(), "sc-layout-"))
	const footer = join(dirname(source), "pi-powerline-footer")
	const path = join(root, "layout.ts")
	writeFileSync(path, `import { computeResponsiveLayout } from ${JSON.stringify(join(footer, "index.ts"))}
import { PRESETS } from ${JSON.stringify(join(footer, "presets.ts"))}
export default function(pi) {
	pi.registerCommand("layout", {
		handler: async (_args, ctx) => pi.appendEntry("layout", computeResponsiveLayout(ctx.segment, PRESETS[ctx.preset], ctx.width)),
	})
}`)
	const loaded = await loader.loadExtensions([path], root)
	assert.deepEqual(loaded.errors, [])
	const tui = await import(pathToFileURL(join(host, "../pi-tui/dist/index.js")))
	let layout
	loaded.runtime.appendEntry = (_type, data) => { layout = data }
	const ctx = {
		segment: {
			model: { id: "gpt-6-astra", name: "GPT 6 Astra", contextWindow: 1000000 },
			thinkingLevel: "medium", sessionId: "session",
			usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			contextPercent: 12.3, contextWindow: 1000000, autoCompactEnabled: true, sessionStartTime: Date.now(),
			git: { branch: "main", staged: 0, unstaged: 0, untracked: 0 },
			extensionStatuses: new Map([["self-compact", "[raw duplicate meter]"]]),
			options: {}, colors: {},
			theme: { fg: (_color, text) => `\x1b[36m${text}\x1b[0m`, bold: text => text },
			compaction: { version: 1, model: "github-copilot/gpt-6-astra", session: "session", used: 123000,
				cached: 0, notice: 180000, warning: 220000, forced: 250000, status: "", locked: false },
		},
	}
	for (const preset of ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"]) {
		for (const width of [10, 12, 20, 30, 40, 60, 80, 100, 120, 180]) {
			ctx.preset = preset
			ctx.width = width
			await loaded.extensions[0].commands.get("layout").handler("", ctx)
			assert.ok(tui.visibleWidth(layout.topContent) <= width - 2, `${preset} at ${width}: top overflow`)
			assert.ok(tui.visibleWidth(layout.secondaryContent) <= width, `${preset} at ${width}: secondary overflow`)
			assert.ok((layout.topContent + layout.secondaryContent).includes("250k"), `${preset} at ${width}: missing budget`)
			assert.ok(!(layout.topContent + layout.secondaryContent).includes("raw duplicate"), "Duplicate status must not leak into layout")
		}
	}
	ctx.preset = "default"
	ctx.width = 180
	ctx.segment.usageStats.cacheRead = 10000
	ctx.segment.usageStats.cost = 1
	await loaded.extensions[0].commands.get("layout").handler("", ctx)
	const text = layout.topContent.replace(/\x1b\[[0-9;]*m/g, "")
	assert.ok(text.indexOf("GPT 6 Astra") < text.indexOf("think:med"))
	assert.ok(text.indexOf("think:med") < text.indexOf("10k"))
	assert.ok(text.indexOf("10k") < text.indexOf("$1.00"))
	assert.ok(text.indexOf("$1.00") < text.indexOf("main"))
	assert.ok(text.indexOf("main") < text.indexOf("250k"))
})

test("late-loaded Powerline requests the live snapshot, hides duplicate status, repaints, and unsubscribes", options, async () => {
	const run = await setup(yaml, 75000)
	const widgets = new Map()
	const statuses = new Map([["self-compact", "[raw fallback meter]"], ["notice", "[other] keep this"]])
	let renders = 0
	const theme = { fg: (_color, text) => text, bold: text => text }
	const tui = { requestRender: () => { renders++ } }
	run.ctx.ui = {
		theme, notify: () => {},
		setStatus: (name, text) => statuses.set(name, text),
		setEditorComponent: () => {},
		setHeader: () => {},
		setWidget: (name, provider) => widgets.set(name, provider?.(tui, theme)),
		setFooter: provider => provider?.(tui, theme, {
			getExtensionStatuses: () => statuses, getGitBranch: () => null, onBranchChange: () => () => {},
		}),
	}
	const footer = join(dirname(source), "pi-powerline-footer", "index.ts")
	const loaded = await loader.loadExtensions([footer], run.root, run.bus)
	assert.deepEqual(loaded.errors, [])
	const extension = loaded.extensions[0]
	try {
		for (const handler of extension.handlers.get("session_start")) await handler({ reason: "startup" }, run.ctx)
		for (let i = 0; i < 50 && !widgets.has("powerline-status"); i++) {
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		assert.ok(widgets.has("powerline-status"), "Powerline widgets initialized")
		assert.deepEqual(widgets.get("powerline-status").render(120), [" [other] keep this"])
		const before = renders
		run.setTokens(90000)
		run.bus.emit("self-compact:footer-request", null)
		assert.ok(renders > before, "Snapshot invalidates the layout and requests repaint")
		run.ctx.model = { ...model, id: "unannounced-switch" }
		assert.equal(statuses.get("self-compact"), undefined, "The legacy gauge stays cleared")
		assert.deepEqual(widgets.get("powerline-status").render(120), [" [other] keep this"],
			"Model identity changes must not restore a duplicate meter")
	} finally {
		for (const handler of extension.handlers.get("session_shutdown")) await handler({}, run.ctx)
		const before = renders
		run.bus.emit("self-compact:footer-request", null)
		assert.equal(renders, before, "Powerline listener is removed on shutdown")
		await run.shutdown()
	}
})
