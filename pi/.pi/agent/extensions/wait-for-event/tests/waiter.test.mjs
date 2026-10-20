import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { EventWaiter, formatResult, normalizeOptions, OUTPUT_LIMIT } from "../waiter.ts";

async function temporary(t) {
	const directory = await mkdtemp(join(tmpdir(), "pi-wait-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

function waiting(t, options, cwd = process.cwd()) {
	let resolve;
	const result = new Promise((done) => { resolve = done; });
	const results = [];
	const waiter = new EventWaiter(normalizeOptions(options, cwd), (value) => {
		results.push(value);
		resolve(value);
	}, 10);
	t.after(() => waiter.cancel());
	waiter.start();
	return { waiter, result, results };
}

async function eventually(predicate) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await sleep(10);
	}
	assert.fail("Expected condition within two seconds");
}

test("validates source selection, timeout, argument types and paths", () => {
	for (const options of [null, {}, { label: "x" }, { label: "x", command: "true", file: "x" },
		{ label: "x", file: "x", args: [] }, { label: "x", command: "true", args: [3] },
		{ label: " ", command: "true" }, { label: "x", file: "x", timeoutSeconds: 0 },
		{ label: "x", file: "x", timeoutSeconds: 86401 }, { label: "x", file: "x", unexpected: true }]) {
		assert.throws(() => normalizeOptions(options, "/tmp"));
	}
	const spec = normalizeOptions({ label: "x", command: "./watch", cwd: "sub" }, "/tmp");
	assert.equal(spec.cwd, "/tmp/sub");
	assert.equal(spec.command, "/tmp/sub/watch");
	assert.equal(spec.timeoutSeconds, 3600);
	assert.equal(normalizeOptions({ label: "x", file: "result", cwd: "sub" }, "/tmp").file, "/tmp/sub/result");
});

test("conflicting modes offer both corrections without guessing the intended source", () => {
	const options = { label: "AWS login for Bedrock review", command: "bash",
		args: ["-c", "while [ ! -s /tmp/unique-login.exit ]; do sleep 1; done"],
		file: "/tmp/unique-login.exit", cwd: "/tmp", timeoutSeconds: 300,
		resumePrompt: "Read login exit status and verify the exact Bedrock model." };
	assert.throws(() => normalizeOptions(options, "/tmp"), (error) => {
		assert.match(error.message, /No wait was armed/);
		assert.match(error.message, /do not invent a placeholder file/);
		assert.match(error.message, /Do not repeat the rejected arguments/);
		const command = JSON.parse(error.message.split("COMMAND mode (launch a foreground watcher): ")[1].split(" FILE mode")[0]);
		const file = JSON.parse(error.message.split("FILE mode (only if a process already writes this file): ")[1].split(" Unused fields")[0]);
		assert.deepEqual(command, { ...options, file: null });
		assert.deepEqual(file, { ...options, command: null, args: null });
		assert.equal(normalizeOptions(command, "/tmp").command, options.command);
		assert.equal(normalizeOptions(file, "/tmp").file, options.file);
		return true;
	});
	assert.equal(options.command, "bash", "validation must not mutate the tool arguments");
});

test("missing mode and file-mode args errors explain how to repair the call", () => {
	assert.throws(() => normalizeOptions({ label: "x" }, "/tmp"), /FILE example:.*COMMAND example:/);
	assert.throws(() => normalizeOptions({ label: "x", file: "event", args: [] }, "/tmp"), (error) => {
		const correction = JSON.parse(error.message.split("Retry with: ")[1]);
		assert.deepEqual(correction, { label: "x", file: "event", command: null, args: null });
		assert.equal(normalizeOptions(correction, "/tmp").file, "/tmp/event");
		return true;
	});
});

test("null optional fields behave like omission without mutating input", () => {
	const options = { label: "CI", command: "gh", args: null, file: null,
		cwd: null, timeoutSeconds: null, resumePrompt: null };
	assert.deepEqual(normalizeOptions(options, "/tmp"), normalizeOptions({ label: "CI", command: "gh" }, "/tmp"));
	assert.equal(options.file, null);
	assert.equal(options.cwd, null);
	assert.deepEqual(normalizeOptions({ ...options, command: null, file: "event" }, "/tmp"),
		normalizeOptions({ label: "CI", file: "event" }, "/tmp"));
	for (const invalid of [{ label: null, command: "gh" }, { label: "CI", command: null, file: null },
		{ ...options, unexpected: null }, { ...options, file: "" }, { ...options, args: [] , command: null, file: "event" }]) {
		assert.throws(() => normalizeOptions(invalid, "/tmp"));
	}
});

test("command captures stdout/stderr and passes arguments without a shell", async (t) => {
	const { result, results } = waiting(t, { label: "command", command: process.execPath,
		args: ["-e", "console.log(process.argv[1]); console.error('stderr')", "$(echo injected)"] });
	const value = await result;
	assert.equal(value.kind, "command");
	assert.equal(value.exitCode, 0);
	assert.match(value.output, /\$\(echo injected\)/);
	assert.match(value.output, /stderr/);
	await sleep(30);
	assert.equal(results.length, 1);
});

test("command exit wakes even when a descendant holds stdout/stderr open", { timeout: 5000 }, async (t) => {
	const directory = await temporary(t);
	const file = join(directory, "descendant.pid");
	const source = `const {spawn}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const child=spawn(process.execPath,['-e',"setInterval(() => {}, 1000)"],{stdio:['ignore',1,2]});
writeFileSync(process.argv[1],String(child.pid)); child.unref(); console.log('direct command finished');`;
	const { result, results } = waiting(t, { label: "inherited pipes", command: process.execPath,
		args: ["-e", source, file], timeoutSeconds: 3 });
	let pid;
	t.after(() => {
		if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
	});
	const value = await result;
	const { readFile } = await import("node:fs/promises");
	pid = Number(await readFile(file, "utf8"));
	assert.equal(value.kind, "command");
	assert.equal(value.exitCode, 0);
	assert.match(value.output, /direct command finished/);
	await sleep(50);
	assert.equal(results.length, 1);
});

test("status includes source, elapsed time, deadline and last file observation", async (t) => {
	const directory = await temporary(t);
	const file = join(directory, "event");
	const { waiter } = waiting(t, { label: "status", file, timeoutSeconds: 30 });
	await sleep(30);
	assert.match(waiter.status(), /Elapsed:.*deadline:/);
	assert.ok(waiter.status().includes(`File: ${file}`));
	assert.match(waiter.status(), /does not exist yet/);
	await writeFile(file, " \n");
	await sleep(30);
	assert.match(waiter.status(), /empty or whitespace/);
});

test("command runs in the requested directory", async (t) => {
	const directory = await temporary(t);
	const { result } = waiting(t, { label: "cwd", command: process.execPath, cwd: directory,
		args: ["-e", "console.log(process.cwd())"] });
	assert.equal((await result).output.trim(), directory);
});

test("nonzero exit and missing executable wake with failure information", async (t) => {
	const { result } = waiting(t, { label: "failed", command: process.execPath, args: ["-e", "process.exit(7)"] });
	assert.equal((await result).exitCode, 7);
	const missing = waiting(t, { label: "missing", command: "/definitely/no/such/executable" });
	assert.equal((await missing.result).kind, "error");
	await sleep(30);
	assert.equal(missing.results.length, 1);
});

test("output retention is bounded and keeps the command tail", async (t) => {
	const { result } = waiting(t, { label: "large", command: process.execPath,
		args: ["-e", "console.log('x'.repeat(100000) + 'TAIL')"] });
	const value = await result;
	assert.equal(value.output.length, OUTPUT_LIMIT);
	assert.equal(value.truncated, true);
	assert.match(value.output, /TAIL\n$/);
});

test("file waits through absence/whitespace and handles atomic replacement without consuming it", async (t) => {
	const directory = await temporary(t);
	const file = join(directory, "event");
	const { result, results } = waiting(t, { label: "file", file });
	await sleep(30);
	assert.equal(results.length, 0);
	await writeFile(file, " \n");
	await sleep(30);
	assert.equal(results.length, 0);
	await writeFile(join(directory, "staged"), "CI complete");
	await rename(join(directory, "staged"), file);
	assert.deepEqual(await result, { kind: "file", output: "CI complete", truncated: false });
	const again = waiting(t, { label: "existing", file });
	assert.equal((await again.result).output, "CI complete");
	assert.equal(results.length, 1);
});

test("file reads are bounded and non-regular files fail", async (t) => {
	const directory = await temporary(t);
	const file = join(directory, "large");
	await writeFile(file, "x".repeat(OUTPUT_LIMIT + 100));
	const large = await waiting(t, { label: "large file", file }).result;
	assert.equal(large.output.length, OUTPUT_LIMIT);
	assert.equal(large.truncated, true);
	assert.equal((await waiting(t, { label: "directory", file: directory }).result).kind, "error");
});

test("timeout wakes once, terminates the command, and is not presented as success", async (t) => {
	const options = { label: "timeout", command: process.execPath,
		args: ["-e", "console.log('started'); setInterval(() => {}, 100)"], timeoutSeconds: 1 };
	const { result, results } = waiting(t, options);
	const value = await result;
	assert.equal(value.kind, "timeout");
	assert.match(value.output, /started/);
	assert.match(formatResult(normalizeOptions(options, process.cwd()), value), /not a successful event/);
	await sleep(50);
	assert.equal(results.length, 1);
});

test("cancellation never wakes, before startup or while watching a file", async (t) => {
	const directory = await temporary(t);
	const file = join(directory, "event");
	const early = waiting(t, { label: "early", file });
	early.waiter.cancel();
	const active = waiting(t, { label: "active", file });
	await sleep(30);
	active.waiter.cancel();
	active.waiter.cancel();
	await writeFile(file, "done");
	await sleep(50);
	assert.equal(early.results.length, 0);
	assert.equal(active.results.length, 0);
});

test("cancellation kills a foreground process without delivering a result", async (t) => {
	const { waiter, results } = waiting(t, { label: "cancel", command: process.execPath,
		args: ["-e", "setInterval(() => {}, 100)"] });
	await sleep(100);
	waiter.cancel();
	await sleep(50);
	assert.equal(results.length, 0);
});

const host = process.env.PI_WAIT_EVENT_HOST;
const runtimeOptions = { skip: !host };
const loader = host ? await import(pathToFileURL(join(host, "dist/core/extensions/loader.js"))) : undefined;
const api = host ? await import(pathToFileURL(join(host, "dist/index.js"))) : undefined;

async function runtime(t) {
	const directory = await temporary(t);
	const loaded = await loader.loadExtensions([new URL("../index.ts", import.meta.url).pathname], directory);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	const session = api.SessionManager.inMemory(directory);
	const messages = [];
	const notices = [];
	const statuses = [];
	loaded.runtime.appendEntry = (type, data) => session.appendCustomEntry(type, data);
	loaded.runtime.sendMessage = (message, delivery) => messages.push({ message, delivery });
	const ctx = { mode: "tui", cwd: directory, isIdle: () => true, sessionManager: session,
		ui: { setStatus: (key, value) => statuses.push({ key, value }), notify: (message) => notices.push(message) } };
	const emit = async (type, event = {}) => {
		let result;
		for (const handler of extension.handlers.get(type) ?? []) result = await handler({ type, ...event }, ctx);
		return result;
	};
	const tool = extension.tools.get("wait_for_event").definition;
	const call = (options, signal) => tool.execute("wait", options, signal, undefined, ctx);
	const command = (args) => extension.commands.get("wait-event").handler(args, ctx);
	t.after(() => emit("session_shutdown", { reason: "quit" }));
	await emit("session_start", { reason: "startup" });
	return { directory, ctx, messages, notices, statuses, emit, tool, call, command, session };
}

test("installed Pi loads the tool, ends the turn, and receives exactly one wake-up", runtimeOptions, async (t) => {
	const run = await runtime(t);
	assert.equal(run.tool.exposure, "model-only");
	const result = await run.call({ label: "CI", command: process.execPath, args: ["-e", "console.log('done')"],
		resumePrompt: "Inspect CI failures" });
	assert.equal(result.terminate, true);
	assert.equal(run.messages.length, 0);
	assert.deepEqual(await run.emit("cache_warming_decision"), { action: "stop" });
	await eventually(() => run.messages.length === 1);
	assert.deepEqual(run.messages[0].delivery, { triggerTurn: true, deliverAs: "followUp" });
	assert.match(run.messages[0].message.content, /Inspect CI failures/);
	assert.equal(await run.emit("cache_warming_decision"), undefined);
	assert.equal(run.statuses.at(-1).value, undefined);
	assert.equal(run.session.getBranch().at(-1).data.status, "completed");
});

test("a rejected mixed-mode call does not arm a wait and can be retried in file mode", runtimeOptions, async (t) => {
	const run = await runtime(t);
	assert.match(run.tool.description, /Never combine non-null command and file/);
	await assert.rejects(run.call({ label: "login", command: process.execPath,
		args: ["-e", "console.log('must not run')"], file: "login.exit" }), /non-null command and file are mutually exclusive/);
	assert.equal(await run.emit("cache_warming_decision"), undefined);
	assert.equal(run.statuses.length, 0);
	assert.equal(run.messages.length, 0);
	const result = await run.call({ label: "login", file: "login.exit", resumePrompt: "Verify the model" });
	assert.equal(result.terminate, true);
	await writeFile(join(run.directory, "login.exit"), "0\n");
	await eventually(() => run.messages.length === 1);
	assert.match(run.messages[0].message.content, /Event file received/);
	assert.match(run.messages[0].message.content, /Verify the model/);
});

test("all-fields-present calls validate against the schema and wake in either mode", runtimeOptions, async (t) => {
	const run = await runtime(t);
	const { validateToolArguments } = await import(pathToFileURL(join(host, "../pi-ai/dist/index.js")));
	const command = { label: "CI", command: process.execPath, args: ["-e", "console.log('done')"],
		file: null, cwd: null, timeoutSeconds: null, resumePrompt: null };
	// Model providers may require all properties even though TypeBox marks them optional.
	const strict = { ...run.tool, parameters: { ...run.tool.parameters,
		required: Object.keys(run.tool.parameters.properties) } };
	const result = await run.call(validateToolArguments(strict, { type: "toolCall", id: "command", name: run.tool.name, arguments: command }));
	assert.equal(result.terminate, true);
	await eventually(() => run.messages.length === 1);
	assert.match(run.messages[0].message.content, /Command exited \(code 0\)/);
	const file = { ...command, label: "login", command: null, args: null, file: "login.exit" };
	await run.call(validateToolArguments(strict, { type: "toolCall", id: "file", name: run.tool.name, arguments: file }));
	await writeFile(join(run.directory, "login.exit"), "0\n");
	await eventually(() => run.messages.length === 2);
	assert.match(run.messages[1].message.content, /Event file received/);
	assert.throws(() => validateToolArguments(strict, { type: "toolCall", id: "invalid", name: run.tool.name,
		arguments: { ...command, label: null } }));
});

test("the real Pi agent loop stops after the arming tool instead of making a polling model call", runtimeOptions, async (t) => {
	const run = await runtime(t);
	const { runAgentLoop } = await import(pathToFileURL(join(host, "../pi-agent-core/dist/agent-loop.js")));
	const { createAssistantMessageEventStream } = await import(pathToFileURL(join(host, "../pi-ai/dist/utils/event-stream.js")));
	let calls = 0;
	const model = { id: "test", name: "test", api: "anthropic-messages", provider: "test", contextWindow: 10000,
		maxTokens: 1000, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
	const stream = () => {
		calls++;
		const message = { role: "assistant", content: calls === 1
			? [{ type: "toolCall", id: "wait", name: "wait_for_event", arguments: { label: "loop", file: "event" } }]
			: [{ type: "text", text: "Unexpected extra model call" }],
			api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
			stopReason: calls === 1 ? "toolUse" : "stop",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		const events = createAssistantMessageEventStream();
		events.push({ type: "done", reason: message.stopReason, message });
		events.end(message);
		return events;
	};
	const context = { messages: [], tools: [{ ...run.tool,
		execute: (id, args, signal, update) => run.tool.execute(id, args, signal, update, run.ctx) }] };
	await runAgentLoop([{ role: "user", content: "Wait for an event", timestamp: Date.now() }], context,
		{ model, convertToLlm: (messages) => messages }, () => {}, undefined, stream);
	assert.equal(calls, 1);
	await sleep(50);
	assert.equal(calls, 1);
	assert.equal(run.messages.length, 0);
	await writeFile(join(run.directory, "event"), "done");
	await eventually(() => run.messages.length === 1);
});

test("duplicate wait is rejected; status/cancel do not trigger the agent", runtimeOptions, async (t) => {
	const run = await runtime(t);
	await run.call({ label: "file", file: "event" });
	await assert.rejects(run.call({ label: "second", file: "other" }), /Already waiting/);
	await run.command("status");
	assert.match(run.notices.at(-1), /Waiting for file/);
	assert.match(run.notices.at(-1), /Elapsed:.*deadline:/);
	assert.match(run.notices.at(-1), /File:.*event/);
	assert.match(run.notices.at(-1), /Last observed:/);
	await run.command("cancel");
	await writeFile(join(run.directory, "event"), "done");
	await sleep(50);
	assert.equal(run.messages.length, 0);
	assert.equal(run.session.getBranch().at(-1).data.status, "cancelled");
});

test("shutdown/tree navigation prevent stale wakes; interrupted commands are not replayed", runtimeOptions, async (t) => {
	const run = await runtime(t);
	await run.call({ label: "old session", file: "event" });
	await run.emit("session_shutdown", { reason: "reload" });
	await run.emit("session_start", { reason: "reload" });
	assert.match(run.notices.at(-1), /interrupted/);
	await writeFile(join(run.directory, "event"), "done");
	await sleep(50);
	assert.equal(run.messages.length, 0);
	await run.call({ label: "tree", file: "tree-event" });
	await run.emit("session_tree");
	await writeFile(join(run.directory, "tree-event"), "done");
	await sleep(50);
	assert.equal(run.messages.length, 0);
});

test("commands arm JSON waits, reject malformed input/busy arming, and deliver a queued follow-up", runtimeOptions, async (t) => {
	const run = await runtime(t);
	await run.command("not json");
	assert.match(run.notices.at(-1), /SyntaxError/);
	run.ctx.isIdle = () => false;
	await run.command('{"label":"busy","file":"event"}');
	assert.match(run.notices.at(-1), /Stop the current/);
	run.ctx.isIdle = () => true;
	await run.command(JSON.stringify({ label: "manual", command: process.execPath, args: ["-e", "process.exit(0)"] }));
	run.ctx.isIdle = () => false;
	await eventually(() => run.messages.length === 1);
	assert.equal(run.messages[0].delivery.deliverAs, "followUp");
});

test("one-shot modes and an already-aborted tool call cannot arm waits", runtimeOptions, async (t) => {
	const run = await runtime(t);
	for (const mode of ["print", "json"]) {
		run.ctx.mode = mode;
		await assert.rejects(run.call({ label: mode, file: "event" }), /live interactive or RPC/);
	}
	run.ctx.mode = "rpc";
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(run.call({ label: "aborted", file: "event" }, controller.signal), /abort/i);
	await run.call({ label: "rpc", command: process.execPath, args: ["-e", "process.exit(0)"] });
	await eventually(() => run.messages.length === 1);
});
