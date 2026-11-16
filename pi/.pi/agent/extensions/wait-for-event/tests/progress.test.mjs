import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { formatProgress, normalizeProgress, parseProgress, ProgressMonitor, PROGRESS_LIMIT } from "../progress.ts";
import { normalizeOptions } from "../waiter.ts";

async function eventually(predicate, milliseconds = 3000) {
	for (let elapsed = 0; elapsed < milliseconds; elapsed += 10) {
		if (predicate()) return;
		await sleep(10);
	}
	assert.fail("Expected progress update");
}

function monitor(t, source, options = {}) {
	const updates = [];
	const spec = normalizeProgress(
		{ command: process.execPath, args: ["-e", source], intervalSeconds: 1, ...options },
		process.cwd(),
	);
	const checker = new ProgressMonitor(spec, process.cwd(), (value, unavailable) =>
		updates.push({ value, unavailable }),
	);
	t.after(() => checker.stop());
	checker.start();
	return { checker, updates, spec };
}

test("optional progress validates nested fields, defaults, nullable fields and cwd-relative paths", () => {
	assert.equal(normalizeProgress(null, "/tmp"), undefined);
	assert.deepEqual(
		normalizeOptions({ label: "x", file: "event", progress: null }, "/tmp"),
		normalizeOptions({ label: "x", file: "event" }, "/tmp"),
	);
	assert.deepEqual(
		normalizeProgress({ command: "./check", args: null, intervalSeconds: null, timeoutSeconds: null }, "/tmp/sub"),
		{ command: "/tmp/sub/check", args: undefined, intervalSeconds: 2, timeoutSeconds: 10 },
	);
	assert.equal(
		normalizeOptions({ label: "x", file: "event", cwd: "sub", progress: { command: "./check" } }, "/tmp").progress
			.command,
		"/tmp/sub/check",
	);
	for (const value of [
		false,
		[],
		"script",
		{},
		{ command: null },
		{ command: " " },
		{ command: "x", args: [1] },
		{ command: "x", unknown: null },
		{ command: "x", intervalSeconds: 0 },
		{ command: "x", intervalSeconds: 1.5 },
		{ command: "x", intervalSeconds: 3601 },
		{ command: "x", timeoutSeconds: 0 },
		{ command: "x", timeoutSeconds: 301 },
	]) {
		assert.throws(() => normalizeOptions({ label: "x", file: "event", progress: value }, "/tmp"));
	}
});

test("progress output requires valid counters; rendering is bounded and strips terminal controls", () => {
	assert.deepEqual(parseProgress('{"current":7,"total":10,"message":"Checks"}'), {
		current: 7,
		total: 10,
		message: "Checks",
	});
	for (const text of [
		"invalid",
		"null",
		"[]",
		"{}",
		'{"current":-1,"total":10}',
		'{"current":11,"total":10}',
		'{"current":0,"total":0}',
		'{"current":"1","total":10}',
		'{"current":1e999,"total":10}',
		'{"current":1,"total":10,"message":3}',
	])
		assert.throws(() => parseProgress(text));
	const lines = formatProgress("CI\n\x1b", { current: 7, total: 10, message: "x".repeat(500) + "\x1b" });
	assert.match(lines[0], /70%  7\/10/);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].split(" · ")[1].length, 200);
	assert.ok(lines.every((line) => !/[\u0000-\u001f\u007f-\u009f]/.test(line)));
	assert.match(formatProgress("CI", undefined, true)[0], /unavailable; still waiting/);
	assert.match(formatProgress("CI", { current: 1, total: 1 }, true).at(-1), /last known value/);
	assert.match(formatProgress("CI", { current: 0, total: 1 })[0], /0%/);
	assert.match(formatProgress("CI", { current: 1, total: 1 })[0], /100%/);
});

test("inline checker updates asynchronously, ignores stderr, and does not repeat after stop", async (t) => {
	const run = monitor(
		t,
		"console.error('diagnostic'); console.log(JSON.stringify({current:7,total:10,message:process.cwd()}))",
	);
	assert.equal(run.updates.length, 1, "initial widget only; checker has not run synchronously");
	await eventually(() => run.updates.length === 2);
	assert.deepEqual(run.updates[1], { value: { current: 7, total: 10, message: process.cwd() }, unavailable: false });
	run.checker.stop();
	run.checker.stop();
	await sleep(1100);
	assert.equal(run.updates.length, 2);
});

test("malformed JSON, nonzero exit, missing command and overflow only mark progress unavailable", async (t) => {
	for (const source of [
		"console.log('invalid')",
		'console.log(\'{"current":1,"total":1}\');process.exit(7)',
		`console.log('x'.repeat(${PROGRESS_LIMIT + 1}))`,
		`console.error('x'.repeat(${PROGRESS_LIMIT + 1}))`,
	]) {
		const run = monitor(t, source);
		await eventually(() => run.updates.length > 1);
		assert.deepEqual(run.updates[1], { value: undefined, unavailable: true });
		run.checker.stop();
	}
	const run = monitor(t, "", { command: "/definitely/no/such/checker" });
	await eventually(() => run.updates.length > 1);
	assert.equal(run.updates[1].unavailable, true);
});

test("a hung checker times out and never overlaps its next invocation", async (t) => {
	const run = monitor(t, "setInterval(()=>{},100)", { timeoutSeconds: 1 });
	await sleep(500);
	assert.equal(run.updates.length, 1);
	await eventually(() => run.updates.length === 2);
	assert.equal(run.updates[1].unavailable, true);
	await sleep(500);
	assert.equal(run.updates.length, 2, "retry scheduled only after the check finished");
	run.checker.stop();
});

test("SIGTERM-resistant checks exit before retries can start", { skip: process.platform === "win32" }, async (t) => {
	const run = monitor(t, "process.on('SIGTERM',()=>{});setInterval(()=>{},100)", { timeoutSeconds: 1 });
	await eventually(() => run.updates.length === 2);
	await sleep(2200);
	assert.equal(run.updates.length, 2, "no overlapping invocation during SIGKILL grace period");
	run.checker.stop();
});

test("failed checks preserve the last value and a later successful check recovers", async (t) => {
	const run = monitor(t, "console.log(JSON.stringify({current:1,total:2}))");
	await eventually(() => run.updates.length === 2);
	run.spec.args = ["-e", "console.log('invalid')"];
	await eventually(() => run.updates.length === 3);
	assert.deepEqual(run.updates[2], { value: { current: 1, total: 2, message: undefined }, unavailable: true });
	run.spec.args = ["-e", "console.log(JSON.stringify({current:2,total:2}))"];
	await eventually(() => run.updates.length === 4);
	assert.equal(run.updates[3].value.current, 2);
	assert.equal(run.updates[3].unavailable, false);
});

test("stopping before startup or during execution suppresses late callbacks", async (t) => {
	const early = monitor(t, 'console.log(\'{"current":1,"total":1}\')');
	early.checker.stop();
	const slow = monitor(t, 'setTimeout(()=>console.log(\'{"current":1,"total":1}\'),500)');
	await sleep(100);
	slow.checker.stop();
	await sleep(600);
	assert.equal(early.updates.length, 1);
	assert.equal(slow.updates.length, 1);
});
