import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = new URL("../scripts/gh-pr-notify.sh", import.meta.url).pathname;
const check = (name, status, conclusion = null) => ({ name, status, conclusion });
const pages = (...runs) => [{ check_runs: runs }];

async function run(t, responses, args = [], notificationFailure = false, options = {}) {
	const root = await mkdtemp(join(tmpdir(), "gh-pr-notify-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "responses.json"), JSON.stringify(responses));
	const commands = {
		gh: `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'api --help' ]]; then
  if [[ "$TEST_HELP" == unsupported ]]; then echo 'Usage: gh api'; else echo 'Usage: gh api --paginate'; fi
  exit 0
fi
if [[ "$1" == "pr" ]]; then
  if [[ "$TEST_METADATA" == error ]]; then echo 'unknown flag: --json' >&2; exit 1; fi
  if [[ "$*" == *headRefOid* ]]; then echo abc123456789; else echo 'Test PR'; fi
  exit 0
fi
# Emulate an older CLI: --slurp is unsupported, --paginate streams objects.
if [[ "$*" == *--slurp* ]]; then echo 'unknown flag: --slurp' >&2; exit 1; fi
[[ "$*" == *--paginate* ]]
[[ "$2" == repos/owner/repo/commits/abc123456789/check-runs ]]
count=0
[[ ! -f "$TEST_ROOT/count" ]] || count=$(<"$TEST_ROOT/count")
printf '%s' "$((count + 1))" > "$TEST_ROOT/count"
response=$(jq -c ".[\${count}]" "$TEST_ROOT/responses.json")
if [[ "$response" == '"error"' || "$response" == null ]]; then echo 'HTTP 503: unavailable' >&2; exit 1; fi
if [[ "$response" == '"unsupported"' ]]; then echo 'unknown flag: --paginate' >&2; exit 1; fi
if [[ "$response" == '"malformed"' ]]; then echo 'not JSON'; exit 0; fi
if [[ "$response" == '"missing-checks"' ]]; then echo '{}'; exit 0; fi
printf '%s\\n' "$response" | jq -c '.[]'
`,
		sleep: '#!/usr/bin/env bash\necho sleep >> "$TEST_ROOT/calls"\n',
		"notify-send": '#!/usr/bin/env bash\necho desktop >> "$TEST_ROOT/calls"\nexit "$NOTIFY_EXIT"\n',
		"phone-notify": '#!/usr/bin/env bash\necho "phone $*" >> "$TEST_ROOT/calls"\nexit "$NOTIFY_EXIT"\n',
	};
	for (const [name, content] of Object.entries(commands)) {
		await writeFile(join(root, name), content, { mode: 0o700 });
	}
	const result = spawnSync("bash", [script, ...(options.preflight ? ["--preflight"] : []), "123", "owner/repo", "15", ...args], {
		env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TEST_ROOT: root,
			NOTIFY_EXIT: notificationFailure ? "1" : "0", TEST_HELP: options.help ?? "supported",
			TEST_METADATA: options.metadata ?? "ok" },
		encoding: "utf8", timeout: 5000,
	});
	assert.equal(result.error, undefined);
	const calls = await readFile(join(root, "calls"), "utf8").catch(() => "");
	return { ...result, calls, polls: Number(await readFile(join(root, "count"), "utf8").catch(() => "0")) };
}

test("no registered checks keeps waiting instead of notifying success", async (t) => {
	const result = await run(t, [pages(), pages(check("build", "completed", "success"))]);
	assert.equal(result.status, 0);
	assert.equal(result.polls, 2);
	assert.match(result.stdout, /Waiting for CI check runs to register/);
	assert.equal(result.calls, "sleep\ndesktop\n");
});

test("pending checks and API failures are retried by the script, not the agent", async (t) => {
	const result = await run(t, ["error", pages(check("build", "in_progress")), pages(check("build", "completed", "success"))]);
	assert.equal(result.status, 0);
	assert.equal(result.polls, 3);
	assert.equal(result.calls, "sleep\nsleep\ndesktop\n");
});

test("all REST pages are considered and CI failures exit nonzero", async (t) => {
	const result = await run(t, [[{ check_runs: [check("build", "completed", "success")] },
		{ check_runs: [check("test", "completed", "failure")] }]]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /1\/2 checks failed/);
	assert.match(result.stdout, /test \(failure\)/);
});

test("neutral and skipped checks count as successful terminal results", async (t) => {
	const result = await run(t, [pages(check("neutral", "completed", "neutral"), check("skipped", "completed", "skipped"))]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /All 2 checks passed/);
	assert.doesNotMatch(result.calls, /phone/);
});

test("action-required, cancelled and timed-out conclusions are failures", async (t) => {
	const result = await run(t, [pages(check("approval", "completed", "action_required"),
		check("cancelled", "completed", "cancelled"), check("timeout", "completed", "timed_out"))]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /3\/3 checks failed/);
});

test("explicit phone notification retains desktop notification", async (t) => {
	const result = await run(t, [pages(check("build", "completed", "success"))], ["--phone"]);
	assert.equal(result.status, 0);
	assert.match(result.calls, /^desktop\nphone --url https:\/\/github.com\/owner\/repo\/pull\/123/);
});

test("notification delivery failures do not change CI status or suppress its result", async (t) => {
	const result = await run(t, [pages(check("build", "completed", "success"))], ["--phone"], true);
	assert.equal(result.status, 0);
	assert.match(result.stderr, /Failed to send desktop notification/);
	assert.match(result.stderr, /Failed to send phone notification/);
	assert.match(result.stdout, /checks passed/);
});

test("unsupported API flags fail immediately without sleeping or notifying", async (t) => {
	const result = await run(t, ["unsupported"]);
	assert.equal(result.status, 3);
	assert.equal(result.polls, 1);
	assert.equal(result.calls, "");
	assert.match(result.stderr, /unknown flag: --paginate/);
	assert.match(result.stderr, /incompatible gh CLI; not retrying/);
});

test("persistent fetch failures stop after three attempts and preserve diagnostics", async (t) => {
	const result = await run(t, ["error", "error", "error"]);
	assert.equal(result.status, 3);
	assert.equal(result.polls, 3);
	assert.equal(result.calls, "sleep\nsleep\n");
	assert.match(result.stderr, /HTTP 503/);
	assert.match(result.stderr, /fetch attempt limit reached/);
	assert.doesNotMatch(result.stdout, /checks passed/);
});

test("successful polls reset the fetch retry budget", async (t) => {
	const result = await run(t, ["error", "error", pages(check("build", "in_progress")),
		"error", "error", pages(check("build", "completed", "success"))]);
	assert.equal(result.status, 0);
	assert.equal(result.polls, 6);
});

test("invalid API responses are monitoring errors, not CI failures or passes", async (t) => {
	for (const response of ["malformed", "missing-checks"]) {
		const result = await run(t, [response]);
		assert.equal(result.status, 3);
		assert.equal(result.polls, 1);
		assert.equal(result.calls, "");
		assert.match(result.stderr, /invalid check-runs response/);
	}
});

test("preflight validates access and streaming pagination without waiting or notifying", async (t) => {
	const result = await run(t, [pages(check("build", "in_progress"))], [], false, { preflight: true });
	assert.equal(result.status, 0);
	assert.equal(result.polls, 1);
	assert.equal(result.calls, "");
	assert.match(result.stdout, /Preflight OK/);
});

test("preflight fails visibly on fetch errors without retrying", async (t) => {
	const result = await run(t, ["error"], [], false, { preflight: true });
	assert.equal(result.status, 3);
	assert.equal(result.polls, 1);
	assert.equal(result.calls, "");
	assert.match(result.stderr, /HTTP 503/);
});

test("unsupported pagination and metadata options fail before polling", async (t) => {
	for (const options of [{ help: "unsupported" }, { metadata: "error" }]) {
		const result = await run(t, [], [], false, options);
		assert.equal(result.status, 3);
		assert.equal(result.polls, 0);
		assert.equal(result.calls, "");
		assert.match(result.stderr, /Monitoring error/);
	}
});

test("invalid intervals and notification options fail before monitoring starts", () => {
	for (const [interval, option] of [["0", ""], ["-1", ""], ["oops", ""], ["15", "--unknown"]]) {
		const result = spawnSync("bash", [script, "123", "owner/repo", interval, option], { encoding: "utf8" });
		assert.equal(result.status, 2);
		assert.doesNotMatch(result.stdout, /Monitoring PR/);
	}
});
