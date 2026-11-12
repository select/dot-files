import { Type } from "@earendil-works/pi-ai";
import { defineTool, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { forkConversation, herdrContext, listWorktrees, openTab, resolveWorktree, run } from "./core.mjs";

export default function worktreeTab(pi: ExtensionAPI) {
  let busy = false;

  async function transfer(path: string, focus: boolean, ctx: ExtensionContext, signal?: AbortSignal, resume = true) {
    if (busy) throw new Error("A worktree tab is already being opened. Inspect that result before retrying.");
    busy = true;
    try {
      const context = herdrContext();
      const execute = (file: string, args: string[], options = {}) => run(file, args, { ...options, signal });
      const tree = await resolveWorktree(path, ctx.cwd, execute);
      signal?.throwIfAborted();
      const model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
      const thinking = pi.getThinkingLevel();
      const session = forkConversation(SessionManager, {
        source: ctx.sessionManager.getSessionFile(), branch: ctx.sessionManager.getBranch(),
        target: tree.path, name: tree.name, model, thinking,
      });
      ctx.ui.notify(`Opening Pi in ${tree.name}…`, "info");
      // Once creation starts, finish the operation even if the agent turn is aborted:
      // interrupting agent.start can leave an ambiguous partially launched tab.
      try {
        const result = await openTab({ context, target: tree.path, name: tree.name, session, model, thinking, focus, resume });
        ctx.ui.notify(result.warning || `Opened ${tree.name} in Herdr tab ${result.tab}. ` +
          `${result.continuationSubmitted ? "Continuation queued at startup." : "Waiting for input."} Original tab kept open.`,
          result.warning ? "warning" : "info");
        return result;
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nForked session: ${session}`);
      }
    } finally {
      busy = false;
    }
  }

  pi.registerCommand("worktree", {
    description: "Carry and continue this conversation in a new Herdr tab in an existing worktree: /worktree [directory]",
    handler: async (args, ctx) => {
      try {
        herdrContext();
        await ctx.waitForIdle();
        let path = args.trim();
        if (!path) {
          if (!ctx.hasUI) throw new Error("Usage: /worktree <directory>");
          const current = await realpath(ctx.cwd);
          const trees = await listWorktrees(ctx.cwd);
          const candidates = [];
          for (const tree of trees) {
            const canonical = await realpath(tree.path).catch(() => undefined);
            if (canonical && canonical !== current) candidates.push({ ...tree, path: canonical });
          }
          if (!candidates.length) throw new Error("No other existing worktrees found for this repository.");
          const labels = candidates.map((tree) => `${tree.path} (${tree.branch || "detached HEAD"})`);
          const choice = await ctx.ui.select("Open this conversation in which worktree?", labels);
          if (!choice) return;
          path = candidates[labels.indexOf(choice)].path;
        }
        await transfer(path, true, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerTool(defineTool({
    name: "open_worktree_tab",
    label: "Open worktree tab",
    description: "Carry the current Pi conversation into a NEW Herdr tab in an existing worktree of the same repository. " +
      "Use only when the user explicitly asks to move/carry this session or conversation to a worktree in Herdr. " +
      "Requires Herdr and a saved session. Continues the unfinished user-requested task after Pi is ready, unless resume=false. " +
      "Does not create worktrees, copy uncommitted changes, or close the original tab. " +
      "The new tab starts with a safe snapshot before this tool-call batch; your later reply is not carried over. " +
      "After success, stop working in the original tab and tell the user to continue in the new tab. Never blindly retry a failed launch.",
    parameters: Type.Object({
      path: Type.String({ description: "Existing worktree root; absolute, ~/…, or relative to Pi's current directory." }),
      focus: Type.Optional(Type.Boolean({ description: "Focus the new tab after startup (default true)." })),
      resume: Type.Optional(Type.Boolean({ description: "Continue the unfinished task with a native Pi startup prompt (default true). Set false for an idle copy." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const result = await transfer(params.path, params.focus ?? true, ctx, signal, params.resume ?? true);
      return {
        content: [{ type: "text", text: `Conversation opened in Herdr tab ${result.tab}, directory ${result.target}. ` +
          `Session: ${result.session}. Original tab remains open. ` +
          `${result.continuationSubmitted ? "Continuation supplied as Pi's startup prompt in the new tab." : "New tab is waiting for input."} ` +
          `Stop working here and continue in the new tab; do not repeat this transfer.` +
          (result.warning ? `\n${result.warning}` : "") }],
        details: result,
      };
    },
  }));
}
