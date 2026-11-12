import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync, readFileSync, existsSync, watch } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { continuationPrompt, forkConversation, herdrContext, openTab, run } from "../core.mjs";

// Resolve direct executables and pnpm cmd-shims without installing another copy.
const executable = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const shimTarget = readFileSync(executable, "utf8").match(/^# cmd-shim-target=(.+)$/m)?.[1];
let packageRoot = process.env.PI_SDK_ROOT || dirname(shimTarget ? realpathSync(shimTarget) : executable);
while (!(existsSync(join(packageRoot, "package.json")) && JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).name === "@earendil-works/pi-coding-agent")) {
  const parent = dirname(packageRoot);
  if (parent === packageRoot) throw new Error("Could not locate installed Pi SDK.");
  packageRoot = parent;
}
const sdkPath = join(packageRoot, "dist/index.js");
const { SessionManager } = await import(pathToFileURL(join(dirname(sdkPath), "core/session-manager.js")));
const { loadExtensions } = await import(pathToFileURL(join(dirname(sdkPath), "core/extensions/loader.js")));
const extensionPath = new URL("../index.ts", import.meta.url).pathname;

test("installed Pi loads the command and tool with no extension errors", async () => {
  const loaded = await loadExtensions([extensionPath], process.cwd());
  assert.deepEqual(loaded.errors, []);
  assert.ok(loaded.extensions[0].commands.has("worktree"));
  assert.ok(loaded.extensions[0].tools.has("open_worktree_tab"));
});

test("real SDK fork preserves active branch and source, excludes pending calls from context", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fork-test-"));
  try {
    const source = SessionManager.create(join(root, "main"), join(root, "source-sessions"));
    const first = source.appendMessage({ role: "user", content: "initial request", timestamp: Date.now() });
    source.appendMessage({ role: "user", content: "abandoned branch", timestamp: Date.now() });
    source.branch(first);
    const active = source.appendMessage({ role: "user", content: "active request", timestamp: Date.now() });
    source.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "pending", name: "open_worktree_tab", arguments: {} }], timestamp: Date.now(), stopReason: "toolUse" });
    const before = await readFile(source.getSessionFile(), "utf8");
    const path = forkConversation(SessionManager, {
      source: source.getSessionFile(), branch: source.getBranch(), target: join(root, "target"), name: "EN-test",
      model: { provider: "example", id: "example-model" }, thinking: "high", sessionDir: join(root, "target-sessions"),
    });
    const fork = SessionManager.open(path);
    assert.notEqual(fork.getSessionId(), source.getSessionId());
    assert.equal(fork.getCwd(), join(root, "target"));
    assert.equal(fork.getHeader().parentSession, source.getSessionFile());
    assert.equal(fork.getSessionName(), "EN-test");
    assert.equal(fork.getBranch().filter((entry) => entry.type === "message").at(-1).id, active);
    const context = fork.buildSessionContext();
    assert.ok(context.messages.some((message) => message.content === "active request"));
    assert.ok(!context.messages.some((message) => message.content === "abandoned branch"));
    assert.ok(!context.messages.some((message) => message.role === "assistant"));
    const handoff = context.messages.find((message) => message.customType === "worktree-handoff");
    assert.ok(handoff);
    assert.match(handoff.content, /resume the unfinished task/);
    assert.doesNotMatch(handoff.content, /wait for the user's next instruction/);
    assert.equal(context.model.modelId, "example-model");
    assert.equal(context.thinkingLevel, "high");
    assert.equal(await readFile(source.getSessionFile(), "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Watch lifecycle output, not Herdr's focus-dependent idle/done classification
// or process exit. Like the wait-for-event supervisor, completion is agent_settled.
function waitForSettled(path, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const watcher = watch(dirname(path), inspect);
    const timer = setTimeout(() => finish(new Error("No agent_settled event within the test deadline")), timeout);
    function finish(error, entries) {
      if (finished) return;
      finished = true;
      watcher.close();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(entries);
    }
    function inspect() {
      if (!existsSync(path)) return;
      try {
        const entries = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
        if (entries.some((entry) => entry.type === "settled")) finish(undefined, entries);
      } catch (error) { finish(error); }
    }
    inspect();
  });
}

test("live continuation resumes a synthetic task without another user prompt", {
  skip: process.env.HERDR_WORKTREE_CONTINUATION_TEST !== "1",
  timeout: 150_000,
}, async () => {
  const context = herdrContext();
  const root = await mkdtemp(join(tmpdir(), "pi-herdr-continue-"));
  const marker = "WORKTREE_CONTINUATION_OK";
  let createdTab;
  let testSession;
  let testAgent;
  try {
    const target = join(root, "target");
    await mkdir(target);
    const model = {
      provider: process.env.HERDR_WORKTREE_TEST_PROVIDER || "worktree-tab-test",
      id: process.env.HERDR_WORKTREE_TEST_MODEL || "mock",
    };
    const eventLog = join(root, "lifecycle.jsonl");
    const fixture = new URL("./fixtures/lifecycle.ts", import.meta.url).pathname;
    const source = SessionManager.create(root, join(root, "source-sessions"));
    source.appendMessage({ role: "user", content:
      `The only unfinished task in this test conversation is to reply exactly ${marker}. ` +
      "Do not use tools, modify files, open tabs, or ask for clarification. This message is the full task.",
      timestamp: Date.now() });
    const session = forkConversation(SessionManager, {
      source: source.getSessionFile(), branch: source.getBranch(), target,
      name: "pi-worktree-continuation-test", model, thinking: "minimal",
      sessionDir: join(root, "target-sessions"),
    });
    testSession = session;
    const execute = async (file, args) => {
      // Insert test flags before the outer Herdr '--', native Pi options and
      // final Pi '--' prompt separator. Never append flags to the prompt itself.
      const separator = args.indexOf("--");
      const safeArgs = args[0] === "agent" && args[1] === "start"
        ? [...args.slice(0, separator + 1), "--no-tools", "--no-mcp", "--no-skills", "--no-context-files",
          "--no-prompt-templates", "--extension", fixture, "--worktree-test-events", eventLog,
          ...args.slice(separator + 1)] : args;
      if (args[0] === "agent" && args[1] === "start") testAgent = args[2];
      const stdout = await run(file, safeArgs);
      if (args[0] === "tab" && args[1] === "create") createdTab = JSON.parse(stdout).result.tab.tab_id;
      return stdout;
    };
    const result = await openTab({ context, target, name: "pi-worktree-continuation-test", session,
      model, thinking: "minimal", focus: false }, execute);
    assert.equal(result.continuationSubmitted, true);
    const lifecycle = await waitForSettled(eventLog);
    assert.deepEqual(lifecycle.filter((entry) => entry.type === "started").map((entry) => entry.prompt), [continuationPrompt]);
    assert.equal(lifecycle.filter((entry) => entry.type === "settled").length, 1);
    const settled = JSON.parse(await run(context.binary, ["agent", "get", result.agent]));
    console.log("Live continuation state:", JSON.stringify(settled));
    const entries = (await readFile(session, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const replies = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant")
      .map((entry) => entry.message);
    assert.ok(replies.some((message) => message.content.some((block) => block.type === "text" && block.text.trim() === marker)),
      `No marker reply in test session. Assistant results: ${JSON.stringify(replies)}`);
    assert.ok(!replies.some((message) => message.content.some((block) => block.type === "toolCall")));
    console.log(`Live continuation verified: ${marker}; tab=${result.tab}.`);
  } catch (error) {
    if (testAgent) console.log("Failure screen:", await run(context.binary,
      ["agent", "read", testAgent, "--source", "recent-unwrapped", "--lines", "80"]).catch(String));
    if (testSession) {
      const entries = (await readFile(testSession, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      console.log("Failure messages:", JSON.stringify(entries.filter((entry) => entry.type === "message" && entry.message.role !== "system")));
    }
    throw error;
  } finally {
    if (createdTab) await run(context.binary, ["tab", "close", createdTab]);
    await rm(root, { recursive: true, force: true });
  }
});

test("live Herdr starts Pi in the target directory without changing focus", {
  skip: process.env.HERDR_WORKTREE_LIVE_TEST !== "1",
  timeout: 90_000,
}, async () => {
  const context = herdrContext();
  const root = await mkdtemp(join(tmpdir(), "pi-herdr-live-"));
  let createdTab;
  try {
    const target = join(root, "worktree with spaces");
    await mkdir(target);
    const source = SessionManager.create(root, join(root, "source-sessions"));
    source.appendMessage({ role: "user", content: "Integration test only. Wait for input; do not make changes.", timestamp: Date.now() });
    const session = forkConversation(SessionManager, { source: source.getSessionFile(), branch: source.getBranch(),
      target, name: "pi-worktree-smoke-test", sessionDir: join(root, "target-sessions") });
    const execute = async (file, args) => {
      const stdout = await run(file, args);
      if (args[0] === "tab" && args[1] === "create") createdTab = JSON.parse(stdout).result.tab.tab_id;
      return stdout;
    };
    // Keep this smoke test model-free: normal transfers resume by default.
    const result = await openTab({ context, target, name: "pi-worktree-smoke-test", session, focus: false, resume: false }, execute);
    assert.equal(result.continuationSubmitted, false);
    assert.equal(result.tab, createdTab);
    const status = JSON.parse(await run(context.binary, ["agent", "get", result.agent]));
    console.log("Live Herdr verification:", JSON.stringify(status));
    assert.equal(status.result.agent.cwd, target);
    assert.equal(status.result.agent.foreground_cwd, target);
    assert.equal(status.result.agent.agent_session.value, session);
    assert.equal(status.result.agent.interactive_ready, true);
    assert.equal(status.result.agent.focused, false);
    const fork = SessionManager.open(session);
    assert.equal(fork.getCwd(), target);
    assert.equal(fork.getSessionName(), "pi-worktree-smoke-test");
  } finally {
    if (createdTab) await run(context.binary, ["tab", "close", createdTab]);
    await rm(root, { recursive: true, force: true });
  }
});
