import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);

export async function run(file, args, options = {}) {
  const { stdout } = await exec(file, args, {
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options,
  });
  return stdout;
}

export function herdrContext(env = process.env) {
  if (env.HERDR_ENV !== "1" || !env.HERDR_WORKSPACE_ID || !env.HERDR_PANE_ID) {
    throw new Error("This command must run inside a Herdr pane.");
  }
  return { binary: env.HERDR_BIN_PATH || "herdr", workspace: env.HERDR_WORKSPACE_ID };
}

export function parseWorktrees(output) {
  return output.split("\0\0").filter(Boolean).map((record) => {
    const fields = record.split("\0").filter(Boolean);
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch "))?.slice(7);
    return { path, branch: branch?.replace(/^refs\/heads\//, ""), bare: fields.includes("bare") };
  }).filter((tree) => tree.path && !tree.bare);
}

export async function listWorktrees(cwd, execute = run) {
  return parseWorktrees(await execute("git", ["worktree", "list", "--porcelain", "-z"], { cwd }));
}

export function expandPath(input, cwd) {
  let path = input.trim();
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
    path = path.slice(1, -1);
  }
  if (!path || /[\0\r\n]/.test(path)) throw new Error("Provide a worktree directory.");
  if (path === "~") path = homedir();
  else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
  return resolve(cwd, path);
}

export async function resolveWorktree(input, cwd, execute = run) {
  const target = await realpath(expandPath(input, cwd));
  const current = await realpath(cwd);
  if (target === current) throw new Error("Pi is already running in that directory.");
  const trees = await listWorktrees(cwd, execute);
  for (const tree of trees) {
    // Pruned/missing worktrees must not prevent selecting a healthy one.
    const canonical = await realpath(tree.path).catch(() => undefined);
    if (canonical === target) return { ...tree, path: target, name: basename(target) };
  }
  throw new Error("Choose the root of an existing worktree belonging to this repository. No worktree was created.");
}

// A tool can run while its assistant message (or sibling tools) has no result yet.
// Fork before that whole assistant message, never into an unmatched tool-call batch.
export function safeForkLeaf(branch) {
  const completed = new Set(branch.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
    .map((entry) => entry.message.toolCallId));
  const incomplete = branch.findIndex((entry) => entry.type === "message" && entry.message.role === "assistant" &&
    Array.isArray(entry.message.content) && entry.message.content.some((block) => block.type === "toolCall" && !completed.has(block.id)));
  const retained = incomplete < 0 ? branch : branch.slice(0, incomplete);
  return retained.at(-1)?.id ?? null;
}

export function forkConversation(SessionManager, { source, branch, target, name, model, thinking, sessionDir }) {
  if (!source) throw new Error("A saved Pi session is required; --no-session sessions cannot be transferred.");
  const fork = SessionManager.forkFrom(source, target, sessionDir);
  const leaf = safeForkLeaf(branch);
  if (leaf) fork.branch(leaf);
  else fork.resetLeaf();
  fork.appendSessionInfo(name);
  if (model) fork.appendModelChange(model.provider, model.id);
  if (thinking) fork.appendThinkingLevelChange(thinking);
  fork.appendCustomMessageEntry("worktree-handoff",
    `This conversation was carried into a new Herdr tab. The current working directory is ${target}. ` +
    "Use this worktree for subsequent work. Re-read applicable project instructions and verify repository state here. " +
    "Uncommitted changes were NOT copied from the original worktree. The original tab remains open. " +
    "The tab-transfer request has already been fulfilled; do not repeat it. " +
    "When prompted to continue, resume the unfinished task from the conversation, not the transfer itself.", true,
    { sourceSession: source, target });
  return fork.getSessionFile();
}

export function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function launchArgs(session, name, model, thinking, resume = false) {
  const args = ["--session", session, "--name", name];
  if (model) args.push("--provider", model.provider, "--model", model.id);
  if (thinking) args.push("--thinking", thinking);
  // Use Pi's own initial-message queue. Herdr can report readiness before a
  // just-started remote Pi reliably processes injected terminal input.
  if (resume) args.push("--", continuationPrompt);
  return args;
}

export const continuationPrompt = "Continue the unfinished task from this forked conversation in the current worktree. " +
  "The worktree/tab transfer is already complete: do not open another tab or repeat the transfer. " +
  "First re-read applicable project instructions and verify repository state; uncommitted changes were not copied. " +
  "Resume only work already requested by the user. If it is complete or no actionable task remains, report that and ask what to do next.";

export async function openTab({ context, target, name, session, model, thinking, focus = true, resume = true }, execute = run) {
  const call = async (args) => {
    const response = JSON.parse(await execute(context.binary, args));
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
  let created;
  try {
    created = await call(["tab", "create", "--workspace", context.workspace,
      "--cwd", target, "--label", name, "--no-focus"]);
  } catch (error) {
    throw new Error(`Herdr tab creation was not confirmed. Inspect workspace ${context.workspace} before retrying; ` +
      `the request may have created a tab. Session saved at ${session}.\n${error.message}`);
  }
  const tab = created?.tab?.tab_id;
  const pane = created?.root_pane?.pane_id;
  if (!tab || !pane) throw new Error(`Herdr returned no tab/pane IDs. Session saved at ${session}; inspect Herdr before retrying.`);
  const args = launchArgs(session, name, model, thinking, resume);
  const agentName = "wt-" + randomBytes(6).toString("hex");
  try {
    await call(["agent", "start", agentName, "--kind", "pi", "--pane", pane,
      "--timeout", "45000", "--", ...args]);
  } catch (error) {
    const recovery = `cd ${shellQuote(target)} && pi ${args.map(shellQuote).join(" ")}`;
    throw new Error(`Created Herdr tab ${tab} (${pane}), but Pi startup was not confirmed. Agent: ${agentName}. ` +
      `The startup task may already be running. Do not retry blindly or close the tab: inspect it first. ` +
      `If Pi is not running, inspect the saved session before using this recovery command: ${recovery}\n${error.message}`);
  }
  let warning;
  if (focus) {
    try { await call(["tab", "focus", tab]); }
    catch (error) { warning = `Pi started, but focusing ${tab} failed: ${error.message}`; }
  }
  return { tab, pane, agent: agentName, session, target, continuationSubmitted: resume, warning };
}
