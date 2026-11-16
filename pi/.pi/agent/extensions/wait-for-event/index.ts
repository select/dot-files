import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EventWaiter, formatResult, normalizeOptions, type WaitResult, type WaitSpec } from "./waiter.ts";
import {
	formatProgress,
	normalizeProgress,
	ProgressMonitor,
	TimerProgressMonitor,
	type ProgressValue,
} from "./progress.ts";

const STATE_TYPE = "wait-for-event-state";
const STATUS_KEY = "wait-for-event";
const WIDGET_KEY = "wait-for-event-progress";
const progressSchema = Type.Union(
	[
		Type.Object(
			{
				command: Type.String({
					minLength: 1,
					description: "Short-lived progress checker executable; inline scripts use bash -c, node -e, etc.",
				}),
				args: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
				intervalSeconds: Type.Optional(
					Type.Union([Type.Integer({ minimum: 1, maximum: 3600 }), Type.Null()], {
						description: "Delay between completed checks; default 2 seconds. Checks never overlap.",
					}),
				),
				timeoutSeconds: Type.Optional(
					Type.Union([Type.Integer({ minimum: 1, maximum: 300 }), Type.Null()], {
						description: "Per-check deadline; default 10 seconds. Failure does not finish the wait.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		Type.Null(),
	],
	{
		description:
			"Optional UI-only checker returning stdout JSON {current,total,message?}. Omit/null for no bar on command/file waits, or an automatic countdown on timer waits. Runs in the wait's cwd; no temporary script files needed.",
	},
);

export default function (pi: ExtensionAPI) {
	let active:
		{ waiter: EventWaiter; ctx: ExtensionContext; progress?: ProgressMonitor | TimerProgressMonitor } | undefined;

	function clearProgress(): void {
		if (!active?.progress) return;
		active.progress.stop();
		active.progress = undefined;
		active.ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	function showProgress(
		current: NonNullable<typeof active>,
		monitor: ProgressMonitor | TimerProgressMonitor,
		value: ProgressValue | undefined,
		unavailable: boolean,
	): void {
		if (active !== current || current.progress !== monitor) return;
		current.ctx.ui.setWidget(WIDGET_KEY, formatProgress(current.waiter.spec.label, value, unavailable));
	}

	function setProgress(options: unknown): void {
		if (!active) throw new Error("No active event wait. Arm wait_for_event first.");
		// Validate first so a rejected replacement leaves the existing checker intact.
		const spec = normalizeProgress(options, active.waiter.spec.cwd);
		clearProgress();
		if (!spec) return;
		const current = active;
		const monitor = new ProgressMonitor(spec, current.waiter.spec.cwd, (value, unavailable) => {
			showProgress(current, monitor, value, unavailable);
		});
		current.progress = monitor;
		monitor.start();
	}

	function stop(): void {
		if (!active) return;
		clearProgress();
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
			clearProgress();
			active = undefined;
			ctx.ui.setStatus(STATUS_KEY, undefined);
			pi.appendEntry(STATE_TYPE, { status: "completed", label: spec.label, result: result.kind });
			pi.sendMessage(
				{
					customType: "wait-for-event-result",
					content: formatResult(spec, result),
					display: true,
					details: { spec, result },
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		});
		pi.appendEntry(STATE_TYPE, { status: "waiting", label: spec.label });
		active = { waiter, ctx };
		ctx.ui.setStatus(STATUS_KEY, `Waiting: ${spec.label} (/wait-event cancel)`);
		waiter.start();
		if (spec.progress) setProgress(spec.progress);
		if (!spec.progress && !spec.command && !spec.file) {
			const current = active;
			const monitor = new TimerProgressMonitor(spec.timeoutSeconds, (value, unavailable) =>
				showProgress(current, monitor, value, unavailable),
			);
			current.progress = monitor;
			monitor.start();
		}
		return spec;
	}

	pi.registerTool(
		defineTool({
			name: "wait_for_event",
			label: "Wait for event",
			exposure: "model-only",
			executionMode: "sequential",
			description:
				"Arm a one-shot background wait and end this agent turn. Wake when a foreground command exits (any exit code), " +
				"or a regular event file exists with non-empty text, or a timer elapses. Choose ONE mode. Omit unused fields or set them to null (if all fields are required by your provider): " +
				"FILE mode: {label:'Login finished', file:'/tmp/unique-login.exit', command:null, args:null} — no command; " +
				"use this when a process already writes a completion file (including a command running in tmux). " +
				"COMMAND mode: {label:'CI finished', command:'gh', args:['run','watch','123','--exit-status'], file:null}. " +
				"TIMER mode: {label:'Pause finished', timeoutSeconds:30} — omit/null command, args and file; an automatic countdown bar appears. " +
				"Never combine non-null command and file. Never invent placeholder paths for unused fields. Do not wrap a file wait in a shell polling loop. " +
				"Waiting uses no model calls. Commands run without a shell; use bash with args ['-c', script] for shell syntax. " +
				"For Pi subagents use scripts/supervise.ts in the wait-for-event extension and wait on its completion.json; " +
				"it signals agent_settled independently of process shutdown. Never rely on a model-written sentinel or Pi exiting. " +
				"Optional progress runs a short-lived checker periodically and only updates a non-blocking widget. " +
				"Checker stdout must be JSON {current,total,message?}; progress never wakes the agent, even at 100%. " +
				"Pass inline scripts with interpreter args, e.g. bash ['-c', script]; do not write temporary script files. " +
				"Use set_wait_progress to attach, replace, or remove progress after arming. " +
				"Keep Pi open. Call this tool alone, not with other tools.",
			promptSnippet: "End the turn until a command exits, an event file arrives, or a timer elapses",
			promptGuidelines: [
				"When a skill needs to wait for an external event, call wait_for_event once, as the only tool in the message; do not poll with bash/sleep.",
				"Use a foreground watcher command that exits only when its event occurs; do not pass nohup, '&', or a daemonizing script.",
				"For a pure time delay, use wait_for_event with an explicit timeoutSeconds and omit/null command, args and file; its countdown bar appears automatically. Do not launch sleep just to implement a timer.",
				"Progress in wait_for_event is optional for command/file waits. Use short-lived read-only inline checkers; set_wait_progress can attach or change them later without restarting the wait.",
				"For event files, choose a unique path per wait to avoid waking on a stale file. The extension never deletes or clears event files.",
				"If a process already writes a completion file, use file mode only: omit command and args or set them to null, rather than sending empty strings/arrays or a shell polling loop.",
				"If wait_for_event rejects arguments, no wait was armed. Follow the correction in the error; never repeat the same invalid arguments.",
				"For delegated Pi work, launch ~/.pi/agent/extensions/wait-for-event/scripts/supervise.ts (Node 24) as documented in its README, then wait on the unique run directory's completion.json. Inspect kind/outcome and artifacts: agent_settled is not proof of task success.",
			],
			// Strict providers may require every property. Null must represent an unused
			// field; otherwise they force fabricated command/file values that conflict.
			parameters: Type.Object(
				{
					progress: Type.Optional(progressSchema),
					label: Type.String({ minLength: 1, description: "Human-readable event name" }),
					command: Type.Optional(
						Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
							description: "COMMAND mode executable. In FILE/TIMER mode omit or set to null.",
						}),
					),
					args: Type.Optional(
						Type.Union([Type.Array(Type.String()), Type.Null()], {
							description: "COMMAND mode literal arguments. In FILE/TIMER mode omit or set to null.",
						}),
					),
					file: Type.Optional(
						Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
							description:
								"FILE mode completion path. In COMMAND/TIMER mode omit or set to null; never invent a placeholder path.",
						}),
					),
					cwd: Type.Optional(
						Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
							description: "Working directory; omit or null for session cwd",
						}),
					),
					timeoutSeconds: Type.Optional(
						Type.Union([Type.Integer({ minimum: 1, maximum: 86400 }), Type.Null()], {
							description:
								"With command/file: safety deadline, default one hour; expiry is a failure. Without command/file: required timer duration, with automatic countdown; expiry resumes normally.",
						}),
					),
					resumePrompt: Type.Optional(
						Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
							description: "What to do on completion; omit or null to continue the user's task",
						}),
					),
				},
				{ additionalProperties: false },
			),
			async execute(_id, params, signal, _update, ctx) {
				signal?.throwIfAborted();
				const spec = arm(params, ctx);
				return {
					content: [
						{
							type: "text",
							text:
								`Waiting for ${spec.label}. The agent turn ends here; an event result will resume it. ` +
								"Do not poll or start extra work. Keep Pi open; /wait-event status or /wait-event cancel manage the wait.",
						},
					],
					details: { spec },
					terminate: true,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "set_wait_progress",
			label: "Set wait progress",
			exposure: "model-only",
			executionMode: "sequential",
			description:
				"Attach or replace an optional non-blocking progress bar on the existing wait_for_event, or remove it with progress:null. " +
				"Returns immediately without ending the turn or changing the main completion event/deadline. " +
				"The checker runs in the wait's cwd, emits stdout JSON {current,total,message?}, and never triggers model calls. " +
				"Use interpreter command and args for inline scripts (bash -c, node -e); no temporary script files. " +
				"Checks must be read-only, short-lived, non-interactive queries. A wait must already be active.",
			promptSnippet: "Attach, replace, or remove a live event wait's optional progress bar",
			parameters: Type.Object({ progress: progressSchema }, { additionalProperties: false }),
			async execute(_id, params, signal) {
				signal?.throwIfAborted();
				setProgress(params.progress);
				return {
					content: [
						{
							type: "text",
							text: params.progress
								? "Progress checker attached. The original event wait remains active."
								: "Progress bar removed. The original event wait remains active.",
						},
					],
					details: {},
				};
			},
		}),
	);

	pi.registerCommand("wait-event", {
		description: "Background event wait: status, cancel, progress <checker JSON|null>, or command/file/timer wait JSON",
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
			if (input.startsWith("progress ")) {
				try {
					setProgress(JSON.parse(input.slice("progress ".length)));
					ctx.ui.notify("Progress updated; the original event wait remains active.", "info");
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
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
	pi.on("cache_warming_decision", () => (active ? { action: "stop" as const } : undefined));
	pi.on("session_shutdown", () => stop());
	pi.on("session_tree", (_event, ctx) => {
		if (!active) return;
		stop();
		ctx.ui.notify("Event wait cancelled after session tree navigation.", "info");
	});
	pi.on("session_start", (_event, ctx) => {
		stop();
		// Never replay arbitrary commands after reload/resume: they may have side effects.
		const entry = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((item) => item.type === "custom" && item.customType === STATE_TYPE);
		if (entry?.type !== "custom") return;
		const data = entry.data as { status?: string; label?: string } | undefined;
		if (data?.status !== "waiting") return;
		pi.appendEntry(STATE_TYPE, { status: "interrupted", label: data.label });
		ctx.ui.notify(
			`Previous wait (${data.label ?? "event"}) was interrupted. Re-arm it explicitly if needed.`,
			"warning",
		);
	});
}
