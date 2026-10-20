import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { OUTPUT_LIMIT } from "./waiter.ts";

export interface SupervisorOptions {
	directory: string;
	args: string[];
	prompt: string;
	cwd?: string;
	command?: string;
	timeoutMilliseconds?: number;
	shutdownMilliseconds?: number;
	killMilliseconds?: number;
	signal?: AbortSignal;
}

export interface Completion {
	runId: string;
	kind: "settled" | "exit" | "timeout" | "error" | "cancelled";
	outcome: "completed" | "error" | "aborted" | "unknown";
	startedAt: string;
	completedAt: string;
	sessionId?: string;
	sessionFile: string;
	lastAssistantText: string;
	stopReason?: string;
	detail?: string;
	exitCode?: number | null;
}

/** One JSON-mode prompt per invocation. Publish before attempting shutdown. */
export async function supervise(options: SupervisorOptions): Promise<Completion> {
	const timeout = options.timeoutMilliseconds ?? 3_600_000;
	const grace = options.shutdownMilliseconds ?? 5_000;
	const killGrace = options.killMilliseconds ?? 2_000;
	for (const value of [timeout, grace, killGrace]) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error("Deadlines must be positive integer milliseconds");
	}
	// Accept only model/tool/resource options, never positional extra prompts.
	// Several prompts would produce several settled events and an ambiguous boundary.
	const values = new Set(["--provider", "--model", "--thinking", "--tools", "--exclude-tools",
		"--extension", "--skill", "--append-system-prompt", "--system-prompt", "--name"]);
	const flags = new Set(["--no-mcp", "--no-extensions", "--no-skills", "--no-prompt-templates",
		"--no-themes", "--no-context-files", "--no-tools", "--no-builtin-tools", "--offline", "--approve", "--no-approve"]);
	for (let i = 0; i < options.args.length; i++) {
		const arg = options.args[i];
		if (flags.has(arg)) continue;
		if (!values.has(arg) || !options.args[i + 1] || options.args[i + 1].startsWith("--")) {
			throw new Error(`Unsupported Pi option: ${arg}. Supervisor owns JSON mode, one prompt and session storage.`);
		}
		i++;
	}
	if (!options.prompt.trim()) throw new Error("Prompt must not be empty");
	const directory = resolve(options.directory);
	// Exclusive creation prevents stale events or overwriting a previous run.
	mkdirSync(directory, { mode: 0o700 });
	const sessionFile = resolve(directory, "session.jsonl");
	const runId = randomUUID();
	const startedAt = new Date().toISOString();
	function atomic(name: string, data: unknown): void {
		const staged = resolve(directory, `${name}.${runId}.tmp`);
		writeFileSync(staged, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
		renameSync(staged, resolve(directory, name));
	}
	atomic("run.json", { runId, startedAt, sessionFile, cwd: resolve(options.cwd ?? process.cwd()) });
	const stdout = openSync(resolve(directory, "events.jsonl"), "wx", 0o600);
	const stderr = openSync(resolve(directory, "stderr.log"), "wx", 0o600);

	return await new Promise<Completion>((done, reject) => {
		let child: ChildProcess | undefined;
		let completion: Completion | undefined;
		let failure: unknown;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let shutdown: ReturnType<typeof setTimeout> | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		let drain: ReturnType<typeof setTimeout> | undefined;
		let buffer = "";
		let sessionId: string | undefined;
		let stopReason: string | undefined;
		let lastAssistantText = "";
		let closed = false;
		let exited = false;

		function kill(signal: NodeJS.Signals): void {
			// Only the Pi process: intentionally persistent previews must survive.
			if (child && !exited) child.kill(signal);
		}
		function finish(): void {
			if (closed) return;
			closed = true;
			for (const clock of [timer, shutdown, escalation, drain]) {
				if (clock !== undefined) clearTimeout(clock);
			}
			options.signal?.removeEventListener("abort", abort);
			child?.stdout?.destroy();
			child?.stderr?.destroy();
			closeSync(stdout);
			closeSync(stderr);
			try {
				atomic("shutdown.json", { runId, exited, exitCode: child?.exitCode, signal: child?.signalCode });
				if (failure) reject(failure);
				else done(completion!);
			} catch (error) { reject(error); }
		}
		function terminate(): void {
			kill("SIGTERM");
			escalation = setTimeout(() => {
				kill("SIGKILL");
				// Bound teardown even if a descendant inherited stdout/stderr.
				drain = setTimeout(finish, killGrace);
			}, killGrace);
		}
		function publish(kind: Completion["kind"], detail?: string, exitCode?: number | null): void {
			if (completion || closed) return;
			completion = {
				runId, kind,
				outcome: kind !== "settled" ? "unknown" : stopReason === "stop" ? "completed"
					: stopReason === "error" ? "error" : stopReason === "aborted" ? "aborted" : "unknown",
				startedAt, completedAt: new Date().toISOString(), sessionId, sessionFile,
				lastAssistantText, stopReason, detail: detail?.slice(-2000), exitCode,
			};
			if (timer !== undefined) clearTimeout(timer);
			// File-mode waits read at most 24,000 bytes. Keep the entire JSON parseable.
			while (Buffer.byteLength(JSON.stringify(completion, null, 2)) > OUTPUT_LIMIT - 256 && completion.lastAssistantText) {
				completion.lastAssistantText = completion.lastAssistantText.slice(Math.ceil(completion.lastAssistantText.length / 2));
			}
			try {
				atomic("completion.json", completion);
			} catch (error) {
				failure = error;
				kill("SIGKILL");
				finish();
				return;
			}
			// The parent can wake now. Cleanup must never gate notification.
			if (kind === "settled") shutdown = setTimeout(terminate, grace);
			else terminate();
		}
		function abort(): void { publish("cancelled", "Supervisor interrupted"); }
		function record(line: string): void {
			if (!line.trim() || completion) return;
			let parsed: unknown;
			try { parsed = JSON.parse(line); }
			catch { publish("error", "Invalid JSON on Pi stdout; inspect events.jsonl"); return; }
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				publish("error", "Invalid Pi event record");
				return;
			}
			const event = parsed as Record<string, unknown>;
			if (event.type === "session" && typeof event.id === "string") sessionId = event.id.slice(0, 200);
			if (event.type === "message_end" && event.message && typeof event.message === "object") {
				const message = event.message as Record<string, unknown>;
				if (message.role === "assistant") {
					stopReason = typeof message.stopReason === "string" ? message.stopReason.slice(0, 40) : undefined;
					lastAssistantText = Array.isArray(message.content)
						? message.content.flatMap((block: unknown) => {
							if (!block || typeof block !== "object") return [];
							const content = block as Record<string, unknown>;
							return content.type === "text" && typeof content.text === "string" ? [content.text] : [];
						}).join("\n").slice(-OUTPUT_LIMIT)
						: "";
				}
			}
			if (event.type === "agent_settled") publish("settled");
		}
		try {
			child = spawn(options.command ?? "pi", ["--mode", "json", "--session", sessionFile, ...options.args, "--", options.prompt], {
				cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], shell: false,
			});
			child.stdout!.setEncoding("utf8");
			child.stdout!.on("data", (text: string) => {
				if (closed) return;
				try {
					writeSync(stdout, text);
					if (completion) return;
					buffer += text;
					let newline;
					// Split ONLY on LF, not Unicode separators inside JSON strings.
					while ((newline = buffer.indexOf("\n")) !== -1) {
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						record(line);
						if (completion) { buffer = ""; break; }
					}
					if (buffer.length > 16 * 1024 * 1024) publish("error", "Pi event exceeds 16 MiB framing limit");
				} catch (error) { publish("error", String(error)); }
			});
			child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
				if (closed) return;
				try { writeSync(stderr, chunk); }
				catch (error) { publish("error", String(error)); }
			});
			child.once("error", (error) => { publish("error", error.message); finish(); });
			child.once("exit", (code) => {
				exited = true;
				if (closed) return;
				// Drain final queued protocol data, but never wait forever for close.
				if (drain !== undefined) clearTimeout(drain);
				drain = setTimeout(() => {
					publish("exit", "Pi exited before agent_settled; inspect logs", code);
					finish();
				}, 250);
			});
			child.once("close", (code) => {
				if (closed) return;
				publish("exit", "Pi exited before agent_settled; inspect logs", code);
				finish();
			});
			timer = setTimeout(() => publish("timeout", `Deadline exceeded (${timeout}ms)`), timeout);
			options.signal?.addEventListener("abort", abort, { once: true });
			if (options.signal?.aborted) abort();
		} catch (error) {
			publish("error", String(error));
			finish();
		}
	});
}
