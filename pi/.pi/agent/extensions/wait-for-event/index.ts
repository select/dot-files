import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EventWaiter, formatResult, normalizeOptions, type WaitResult, type WaitSpec } from "./waiter.ts";

const STATE_TYPE = "wait-for-event-state";
const STATUS_KEY = "wait-for-event";

export default function (pi: ExtensionAPI) {
	let active: { waiter: EventWaiter; ctx: ExtensionContext } | undefined;

	function stop(): void {
		if (!active) return;
		active.waiter.cancel();
		active.ctx.ui.setStatus(STATUS_KEY, undefined);
		active = undefined;
	}

	function arm(options: unknown, ctx: ExtensionContext): WaitSpec {
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
			throw new Error("wait_for_event needs a live interactive or RPC session; print/JSON mode exits after the turn.");
		}
		if (active) throw new Error(`Already waiting for ${active.waiter.spec.label}. Use /wait-event cancel first.`);
		const spec = normalizeOptions(options, ctx.cwd);
		const waiter = new EventWaiter(spec, (result: WaitResult) => {
			if (active?.waiter !== waiter) return;
			active = undefined;
			ctx.ui.setStatus(STATUS_KEY, undefined);
			pi.appendEntry(STATE_TYPE, { status: "completed", label: spec.label, result: result.kind });
			pi.sendMessage({
				customType: "wait-for-event-result",
				content: formatResult(spec, result),
				display: true,
				details: { spec, result },
			}, { triggerTurn: true, deliverAs: "followUp" });
		});
		pi.appendEntry(STATE_TYPE, { status: "waiting", label: spec.label });
		active = { waiter, ctx };
		ctx.ui.setStatus(STATUS_KEY, `Waiting: ${spec.label} (/wait-event cancel)`);
		waiter.start();
		return spec;
	}

	pi.registerTool(defineTool({
		name: "wait_for_event",
		label: "Wait for event",
		exposure: "model-only",
		executionMode: "sequential",
		description: "Arm a one-shot background wait and end this agent turn. Wake when a foreground command exits (any exit code), " +
			"or a regular event file exists with non-empty text. Choose ONE mode. Omit unused fields or set them to null (if all fields are required by your provider): " +
			"FILE mode: {label:'Login finished', file:'/tmp/unique-login.exit', command:null, args:null} — no command; " +
			"use this when a process already writes a completion file (including a command running in tmux). " +
			"COMMAND mode: {label:'CI finished', command:'gh', args:['run','watch','123','--exit-status'], file:null}. " +
			"Never combine non-null command and file. Never invent placeholder paths for unused fields. Do not wrap a file wait in a shell polling loop. " +
			"Waiting uses no model calls. Commands run without a shell; use bash with args ['-c', script] for shell syntax. " +
			"For Pi subagents use scripts/supervise.ts in the wait-for-event extension and wait on its completion.json; " +
			"it signals agent_settled independently of process shutdown. Never rely on a model-written sentinel or Pi exiting. " +
			"Keep Pi open. Call this tool alone, not with other tools.",
		promptSnippet: "End the turn until a command exits or an event file arrives",
		promptGuidelines: [
			"When a skill needs to wait for an external event, call wait_for_event once, as the only tool in the message; do not poll with bash/sleep.",
			"Use a foreground watcher command that exits only when its event occurs; do not pass nohup, '&', or a daemonizing script.",
			"For event files, choose a unique path per wait to avoid waking on a stale file. The extension never deletes or clears event files.",
			"If a process already writes a completion file, use file mode only: omit command and args or set them to null, rather than sending empty strings/arrays or a shell polling loop.",
			"If wait_for_event rejects arguments, no wait was armed. Follow the correction in the error; never repeat the same invalid arguments.",
			"For delegated Pi work, launch ~/.pi/agent/extensions/wait-for-event/scripts/supervise.ts (Node 24) as documented in its README, then wait on the unique run directory's completion.json. Inspect kind/outcome and artifacts: agent_settled is not proof of task success.",
		],
		// Strict providers may require every property. Null must represent an unused
		// field; otherwise they force fabricated command/file values that conflict.
		parameters: Type.Object({
			label: Type.String({ minLength: 1, description: "Human-readable event name" }),
			command: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
				description: "COMMAND mode executable. In FILE mode omit or set to null.",
			})),
			args: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()], {
				description: "COMMAND mode literal arguments. In FILE mode omit or set to null.",
			})),
			file: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
				description: "FILE mode completion path. In COMMAND mode omit or set to null; never invent a placeholder path.",
			})),
			cwd: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
				description: "Working directory; omit or null for session cwd",
			})),
			timeoutSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 86400 }), Type.Null()], {
				description: "Deadline; omit or null for 3600 seconds (one hour)",
			})),
			resumePrompt: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
				description: "What to do on completion; omit or null to continue the user's task",
			})),
		}, { additionalProperties: false }),
		async execute(_id, params, signal, _update, ctx) {
			signal?.throwIfAborted();
			const spec = arm(params, ctx);
			return {
				content: [{ type: "text", text: `Waiting for ${spec.label}. The agent turn ends here; an event result will resume it. ` +
					"Do not poll or start extra work. Keep Pi open; /wait-event status or /wait-event cancel manage the wait." }],
				details: { spec },
				terminate: true,
			};
		},
	}));

	pi.registerCommand("wait-event", {
		description: "Background event wait: status, cancel, or a JSON object with label and command/file",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input || input === "status") {
				ctx.ui.notify(active ? active.waiter.status() : "No active event wait", "info");
				return;
			}
			if (input === "cancel") {
				if (!active) {
					ctx.ui.notify("No active event wait", "info");
					return;
				}
				const label = active.waiter.spec.label;
				stop();
				pi.appendEntry(STATE_TYPE, { status: "cancelled", label });
				ctx.ui.notify(`Cancelled: ${label}. No agent turn was triggered.`, "info");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Stop the current agent turn before arming a wait with this command.", "warning");
				return;
			}
			try {
				const spec = arm(JSON.parse(input), ctx);
				ctx.ui.notify(`Waiting for ${spec.label}`, "info");
			} catch (error) {
				ctx.ui.notify(String(error), "error");
			}
		},
	});

	// Suppress optional idle prompt-cache requests while a wait is armed.
	pi.on("cache_warming_decision", () => active ? { action: "stop" as const } : undefined);
	pi.on("session_shutdown", () => stop());
	pi.on("session_tree", (_event, ctx) => {
		if (!active) return;
		stop();
		ctx.ui.notify("Event wait cancelled after session tree navigation.", "info");
	});
	pi.on("session_start", (_event, ctx) => {
		stop();
		// Never replay arbitrary commands after reload/resume: they may have side effects.
		const entry = [...ctx.sessionManager.getBranch()].reverse().find(
			(item) => item.type === "custom" && item.customType === STATE_TYPE,
		);
		if (entry?.type !== "custom") return;
		const data = entry.data as { status?: string; label?: string } | undefined;
		if (data?.status !== "waiting") return;
		pi.appendEntry(STATE_TYPE, { status: "interrupted", label: data.label });
		ctx.ui.notify(`Previous wait (${data.label ?? "event"}) was interrupted. Re-arm it explicitly if needed.`, "warning");
	});
}
