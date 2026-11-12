import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { continuationPrompt, forkConversation, herdrContext, parseWorktrees, safeForkLeaf, shellQuote, expandPath, resolveWorktree, openTab, run } from "../core.mjs";

const message = (id, role, content, extra = {}) => ({ type: "message", id, message: { role, content, ...extra } });

test("requires inherited Herdr context, not another client's focused pane", () => {
  assert.throws(() => herdrContext({}), /inside a Herdr/);
  assert.throws(() => herdrContext({ HERDR_ENV: "1" }), /inside a Herdr/);
  assert.deepEqual(herdrContext({ HERDR_ENV: "1", HERDR_PANE_ID: "w7:p3", HERDR_WORKSPACE_ID: "w7", HERDR_BIN_PATH: "/a b/herdr" }),
    { binary: "/a b/herdr", workspace: "w7" });
});

test("parses NUL-delimited paths without splitting spaces or quoted names", () => {
  assert.deepEqual(parseWorktrees("worktree /repo 'one'\0HEAD abc\0branch refs/heads/feature/one\0\0worktree /bare\0bare\0\0worktree /detached\0HEAD def\0detached\0\0"), [
    { path: "/repo 'one'", branch: "feature/one", bare: false },
    { path: "/detached", branch: undefined, bare: false },
  ]);
});

test("resolves quoted paths without shell expansion or evaluation", () => {
  assert.equal(expandPath("'../a b'", "/repo/main"), "/repo/a b");
  assert.equal(expandPath("$(touch nope)", "/repo"), "/repo/$(touch nope)");
  assert.throws(() => expandPath("", "/repo"));
  assert.throws(() => expandPath("foo\nbar", "/repo"));
});

test("retains the active leaf when every tool has completed", () => {
  const branch = [message("a", "assistant", [{ type: "toolCall", id: "call" }]), message("r", "toolResult", [], { toolCallId: "call" }), { id: "metadata", type: "custom" }];
  assert.equal(safeForkLeaf(branch), "metadata");
});

test("cuts before an incomplete parallel tool batch", () => {
  const branch = [message("user", "user", "move"), message("a", "assistant", [{ type: "toolCall", id: "done" }, { type: "toolCall", id: "pending" }]), message("r", "toolResult", [], { toolCallId: "done" })];
  assert.equal(safeForkLeaf(branch), "user");
  assert.equal(safeForkLeaf(branch.slice(1)), null);
  assert.equal(safeForkLeaf([]), null);
});

test("fork selects safe leaf, records model and new directory, never mutates source", () => {
  const calls = [];
  const manager = new Proxy({}, { get: (_, method) => (...args) => { calls.push([method, ...args]); if (method === "getSessionFile") return "/target/session.jsonl"; } });
  const SDK = { forkFrom: (...args) => { calls.push(["forkFrom", ...args]); return manager; } };
  const result = forkConversation(SDK, { source: "/source/session.jsonl", branch: [{ id: "active", type: "custom" }], target: "/worktree", name: "issue", model: { provider: "provider", id: "model" }, thinking: "high" });
  assert.equal(result, "/target/session.jsonl");
  assert.deepEqual(calls[0], ["forkFrom", "/source/session.jsonl", "/worktree", undefined]);
  assert.deepEqual(calls[1], ["branch", "active"]);
  assert.ok(calls.some(([method, text]) => method === "appendSessionInfo" && text === "issue"));
  assert.ok(calls.some(([method, , text]) => method === "appendCustomMessageEntry" && text.includes("/worktree") && text.includes("NOT copied")));
  const handoff = calls.find(([method]) => method === "appendCustomMessageEntry")[2];
  assert.match(handoff, /resume the unfinished task/);
  assert.doesNotMatch(handoff, /wait for the user's next instruction/);
  assert.throws(() => forkConversation(SDK, { branch: [] }), /saved Pi session/);
});

test("shell recovery command quotes apostrophes safely", async () => {
  const text = "a ' b; $(echo unsafe)";
  assert.equal(await run("sh", ["-c", `printf %s ${shellQuote(text)}`]), text);
});

function fakeHerdr(failAt) {
  const calls = [];
  return { calls, execute: async (binary, args) => {
    calls.push([binary, ...args]);
    if (args.slice(0, 2).join(" ") === failAt) throw new Error("test failure");
    return JSON.stringify({ result: args[0] === "tab" && args[1] === "create" ? { tab: { tab_id: "w2:t9" }, root_pane: { pane_id: "w2:p11" } } : {} });
  } };
}
const options = { context: { binary: "/herdr", workspace: "w2" }, target: "/a b", name: "issue 'one'", session: "/session 'one'.jsonl", model: { provider: "example", id: "model" }, thinking: "medium" };

test("starts Pi with exactly one native continuation prompt, then focuses the returned tab", async () => {
  const fake = fakeHerdr();
  const result = await openTab(options, fake.execute);
  assert.equal(result.pane, "w2:p11");
  assert.deepEqual(fake.calls[0], ["/herdr", "tab", "create", "--workspace", "w2", "--cwd", "/a b", "--label", "issue 'one'", "--no-focus"]);
  assert.match(fake.calls[1][3], /^wt-[a-f0-9]{12}$/);
  assert.ok(fake.calls[1].includes("w2:p11"));
  assert.ok(fake.calls[1].includes("/session 'one'.jsonl"));
  assert.deepEqual(fake.calls[1].slice(-2), ["--", continuationPrompt]);
  assert.equal(fake.calls[1].filter((arg) => arg === continuationPrompt).length, 1);
  assert.deepEqual(fake.calls[2], ["/herdr", "tab", "focus", "w2:t9"]);
  assert.equal(result.continuationSubmitted, true);
  assert.equal(fake.calls.length, 3);
  assert.ok(!fake.calls.some((call) => call[1] === "agent" && call[2] === "prompt"));
  assert.match(continuationPrompt, /unfinished task/);
  assert.match(continuationPrompt, /do not open another tab/);
  assert.match(continuationPrompt, /only work already requested by the user/);
});

test("background mode leaves focus alone", async () => {
  const fake = fakeHerdr();
  const result = await openTab({ ...options, focus: false }, fake.execute);
  assert.equal(fake.calls.length, 2);
  assert.equal(result.continuationSubmitted, true);
  assert.deepEqual(fake.calls.at(-1).slice(-2), ["--", continuationPrompt]);
});

test("resume=false starts an idle copy without submitting a prompt", async () => {
  const fake = fakeHerdr();
  const result = await openTab({ ...options, resume: false }, fake.execute);
  assert.equal(result.continuationSubmitted, false);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[2], ["/herdr", "tab", "focus", "w2:t9"]);
  assert.ok(!fake.calls.some((call) => call.includes(continuationPrompt)));
});

test("ambiguous tab creation failure does not retry or start an agent", async () => {
  const fake = fakeHerdr("tab create");
  await assert.rejects(openTab(options, fake.execute), /Inspect workspace w2 before retrying/);
  assert.equal(fake.calls.length, 1);
});

test("startup failure preserves tab and fork and provides recovery without retrying", async () => {
  const fake = fakeHerdr("agent start");
  await assert.rejects(openTab(options, fake.execute), /Created Herdr tab w2:t9.*Do not retry blindly.*cd /s);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].filter((arg) => arg === continuationPrompt).length, 1);
});

test("focus failure is a warning, not a failed transfer that might get retried", async () => {
  const fake = fakeHerdr("tab focus");
  const result = await openTab(options, fake.execute);
  assert.match(result.warning, /Pi started/);
});

test("real git validation accepts sibling worktree roots, rejects current/subdirectory/unrelated repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worktree-test-"));
  try {
    const main = join(root, "main");
    const target = join(root, "issue 'with spaces'");
    const unrelated = join(root, "unrelated");
    await mkdir(main); await mkdir(unrelated);
    await run("git", ["init", "-q", main]);
    await run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "init"], { cwd: main });
    await run("git", ["worktree", "add", "-qb", "test-issue", target], { cwd: main });
    await run("git", ["init", "-q", unrelated]);
    await mkdir(join(target, "sub"));
    assert.equal((await resolveWorktree(target, main)).path, target);
    await assert.rejects(resolveWorktree(main, main), /already running/);
    await assert.rejects(resolveWorktree(join(target, "sub"), main), /root of an existing/);
    await assert.rejects(resolveWorktree(unrelated, main), /root of an existing/);
    await assert.rejects(resolveWorktree(join(root, "missing"), main), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
