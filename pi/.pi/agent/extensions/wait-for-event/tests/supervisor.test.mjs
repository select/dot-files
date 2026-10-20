import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventWaiter, normalizeOptions, OUTPUT_LIMIT } from "../waiter.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { supervise } from "../supervisor.ts";

async function fixture(t, source) {
	const directory = await mkdtemp(join(tmpdir(), "pi-supervisor-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const command = join(directory, "fake-pi");
	await writeFile(command, `#!${process.execPath}\n${source}\n`);
	await chmod(command, 0o700);
	return { directory: join(directory, "run"), command, args: [], prompt: "test",
		timeoutMilliseconds: 2000, shutdownMilliseconds: 100, killMilliseconds: 100 };
}
const emit = `const emit = (value) => console.log(JSON.stringify(value));
const final = (stopReason = 'stop') => emit({type:'message_end', message:{role:'assistant', stopReason,
content:[{type:'text',text:'Finished\u2028with Unicode separator'}]}});
emit({type:'session', id:'test-session'});`;
async function completion(directory) {
	for (let i = 0; i < 200; i++) {
		const text = await readFile(join(directory, "completion.json"), "utf8").catch(() => null);
		if (text) return JSON.parse(text);
		await sleep(10);
	}
	assert.fail("Completion was not published within two seconds");
}

test("settled publishes before shutdown, even if Pi hangs; logs continue draining", async (t) => {
	const options = await fixture(t, `${emit}
final(); emit({type:'agent_settled'});
console.error('still draining stderr');
setInterval(() => {}, 1000);`);
	options.shutdownMilliseconds = 500;
	let returned = false;
	const pending = supervise(options).then((value) => { returned = true; return value; });
	const event = await completion(options.directory);
	assert.equal(event.kind, "settled");
	assert.equal(event.outcome, "completed");
	assert.equal(event.sessionId, "test-session");
	assert.equal(event.lastAssistantText, "Finished\u2028with Unicode separator");
	assert.equal(returned, false, "process cleanup must not gate completion publication");
	assert.equal((await pending).runId, event.runId);
	assert.match(await readFile(join(options.directory, "stderr.log"), "utf8"), /still draining/);
	const shutdown = JSON.parse(await readFile(join(options.directory, "shutdown.json"), "utf8"));
	assert.equal(shutdown.exited, true);
	assert.equal(shutdown.signal, "SIGTERM");
});

test("agent_end/final message are not completion; recovery may still run", async (t) => {
	const options = await fixture(t, `${emit}
final('error'); emit({type:'agent_end',willRetry:true});
setTimeout(() => { final(); emit({type:'agent_settled'}); }, 150);`);
	const value = await supervise(options);
	assert.equal(value.kind, "settled");
	assert.equal(value.outcome, "completed");
	assert.ok(Date.parse(value.completedAt) - Date.parse(value.startedAt) >= 150);
});

test("crash before settling produces failure even with a final assistant message", async (t) => {
	const options = await fixture(t, `${emit} final(); process.exitCode = 7;`);
	const value = await supervise(options);
	assert.equal(value.kind, "exit");
	assert.equal(value.outcome, "unknown");
	assert.equal(value.exitCode, 7);
});

test("settled is not equivalent to success, including terminated tool runs", async (t) => {
	for (const [reason, outcome] of [["error", "error"], ["aborted", "aborted"], ["toolUse", "unknown"]]) {
		const options = await fixture(t, `${emit} final('${reason}'); emit({type:'agent_settled'});`);
		const value = await supervise(options);
		assert.equal(value.kind, "settled");
		assert.equal(value.outcome, outcome);
	}
});

test("timeout, malformed protocol and missing executable each emit a failure", async (t) => {
	const hanging = await fixture(t, "setInterval(() => {}, 1000)");
	hanging.timeoutMilliseconds = 80;
	assert.equal((await supervise(hanging)).kind, "timeout");
	const invalid = await fixture(t, "console.log('not JSON'); setInterval(() => {}, 1000)");
	assert.equal((await supervise(invalid)).kind, "error");
	const missing = await fixture(t, "");
	missing.command = join(missing.directory, "missing");
	assert.equal((await supervise(missing)).kind, "error");
});

test("duplicate settled/exit events never overwrite completion", async (t) => {
	const options = await fixture(t, `${emit} final(); emit({type:'agent_settled'});
emit({type:'agent_settled'}); process.exitCode=9;`);
	const value = await supervise(options);
	assert.deepEqual(await completion(options.directory), JSON.parse(JSON.stringify(value)));
	assert.equal(value.kind, "settled");
	assert.equal(value.exitCode, undefined);
});

test("split JSON records are accepted; an unterminated record is not a settled event", async (t) => {
	const split = await fixture(t, `${emit} final(); process.stdout.write('{"type":"agent_');
setTimeout(() => process.stdout.write('settled"}\\n'), 20);`);
	assert.equal((await supervise(split)).kind, "settled");
	const incomplete = await fixture(t, `process.stdout.write('{"type":"agent_settled"}');`);
	assert.equal((await supervise(incomplete)).kind, "exit");
});

test("cancellation and SIGTERM-resistant shutdown are bounded", async (t) => {
	const options = await fixture(t, `${emit} process.on('SIGTERM', () => {});
final(); emit({type:'agent_settled'}); setInterval(() => {}, 1000);`);
	assert.equal((await supervise(options)).kind, "settled");
	assert.equal(JSON.parse(await readFile(join(options.directory, "shutdown.json"))).signal, "SIGKILL");
	const cancelled = await fixture(t, "setInterval(() => {}, 1000)");
	const controller = new AbortController();
	const pending = supervise({ ...cancelled, signal: controller.signal });
	controller.abort();
	assert.equal((await pending).kind, "cancelled");
});

test("supervisor cleanup does not wait forever for inherited output pipes", { timeout: 5000 }, async (t) => {
	const options = await fixture(t, `${emit}
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{stdio:['ignore',1,2]});
console.error('descendant='+child.pid); child.unref();
final(); emit({type:'agent_settled'});`);
	let pid;
	t.after(() => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
	const value = await supervise(options);
	const log = await readFile(join(options.directory, "stderr.log"), "utf8");
	pid = Number(log.match(/descendant=(\d+)/)[1]);
	assert.equal(value.kind, "settled");
	assert.equal(JSON.parse(await readFile(join(options.directory, "shutdown.json"))).exited, true);
	process.kill(pid, 0); // Parent cleanup must not kill intentionally persistent descendants.
});

test("completion JSON fits inside the file waiter's byte limit", async (t) => {
	const options = await fixture(t, `${emit}
emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'\\u0000'.repeat(30000)}]}});
emit({type:'agent_settled'});`);
	await supervise(options);
	const text = await readFile(join(options.directory, "completion.json"), "utf8");
	assert.ok(Buffer.byteLength(text) <= OUTPUT_LIMIT);
	assert.equal(JSON.parse(text).outcome, "completed");
});

test("installed Pi settles and wakes the parent despite deliberately hung shutdown", {
	skip: !process.env.PI_WAIT_EVENT_HOST, timeout: 30000,
}, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-supervisor-host-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = join(root, "run");
	const wakes = [];
	let wake;
	const event = new Promise((resolve) => { wake = resolve; });
	const waiter = new EventWaiter(normalizeOptions({ label: "local worker", file: join(directory, "completion.json"),
		timeoutSeconds: 25 }, root), (value) => { wakes.push(value); wake(value); }, 10);
	t.after(() => waiter.cancel());
	waiter.start();
	const pending = supervise({ directory, cwd: root, prompt: "Local fixture only", timeoutMilliseconds: 20000,
		shutdownMilliseconds: 200, killMilliseconds: 200,
		args: ["--offline", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--no-context-files",
			"--extension", fileURLToPath(new URL("./fixtures/mock-provider.ts", import.meta.url)),
			"--provider", "wait-event-test", "--model", "mock"] });
	const received = await event;
	const value = await pending;
	const diagnostics = await readFile(join(directory, "stderr.log"), "utf8");
	assert.equal(received.kind, "file", diagnostics);
	assert.equal(value.kind, "settled", diagnostics);
	assert.equal(value.outcome, "completed", diagnostics);
	assert.equal(JSON.parse(received.output).runId, value.runId);
	assert.equal(wakes.length, 1);
	assert.match(await readFile(join(directory, "events.jsonl"), "utf8"), /agent_settled/);
	assert.equal(JSON.parse(await readFile(join(directory, "shutdown.json"))).signal, "SIGTERM");
});

test("CLI reads one prompt file and forwards model options to JSON-mode Pi", async (t) => {
	const options = await fixture(t, `${emit}
if (!process.argv.includes('one explicit prompt') || !process.argv.includes('--mode') || !process.argv.includes('json')) process.exit(8);
final(); emit({type:'agent_settled'});`);
	const root = dirname(options.command);
	await copyFile(options.command, join(root, "pi"));
	await chmod(join(root, "pi"), 0o700);
	const prompt = join(root, "prompt.txt");
	await writeFile(prompt, "one explicit prompt");
	const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/supervise.ts", import.meta.url)),
		"--run-dir", options.directory, "--prompt-file", prompt, "--timeout-seconds", "3", "--", "--model", "mock"],
		{ env: { ...process.env, PATH: `${root}:${process.env.PATH}` }, timeout: 5000 });
	assert.equal(JSON.parse(result.stdout).kind, "settled");
	assert.equal(JSON.parse(result.stdout).outcome, "completed");
});

test("existing run directories and conflicting/extra prompt arguments are rejected", async (t) => {
	const options = await fixture(t, `${emit} final(); emit({type:'agent_settled'});`);
	await supervise(options);
	const original = await readFile(join(options.directory, "completion.json"), "utf8");
	await assert.rejects(supervise(options), /EEXIST/);
	assert.equal(await readFile(join(options.directory, "completion.json"), "utf8"), original);
	for (const args of [["--mode", "text"], ["--session", "old.jsonl"], ["extra prompt"], ["--model"]]) {
		await assert.rejects(supervise({ ...options, args }), /Unsupported Pi option/);
	}
});
