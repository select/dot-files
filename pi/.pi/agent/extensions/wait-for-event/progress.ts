import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { resolve } from "node:path"

export const PROGRESS_LIMIT = 24_000

export interface ProgressOptions {
	command: string
	args?: string[]
	intervalSeconds?: number
	timeoutSeconds?: number
}

export interface ProgressSpec extends ProgressOptions {
	intervalSeconds: number
	timeoutSeconds: number
}

export interface ProgressValue {
	current: number
	total: number
	message?: string
}

export function normalizeProgress(value: unknown, cwd: string): ProgressSpec | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("progress must be an object or null")
	const input = value as Record<string, unknown>
	const allowed = new Set(["command", "args", "intervalSeconds", "timeoutSeconds"])
	for (const key of Object.keys(input)) {
		if (!allowed.has(key)) throw new Error(`Unknown progress option: ${key}`)
	}
	if (typeof input.command !== "string" || !input.command.trim()) {
		throw new Error("progress.command must be a non-empty string")
	}
	if (input.args != null && (!Array.isArray(input.args) || !input.args.every((arg) => typeof arg === "string"))) {
		throw new Error("progress.args must be an array of strings")
	}
	const interval = input.intervalSeconds ?? 2
	const timeout = input.timeoutSeconds ?? 10
	if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 3600) {
		throw new Error("progress.intervalSeconds must be an integer between 1 and 3600")
	}
	if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
		throw new Error("progress.timeoutSeconds must be an integer between 1 and 300")
	}
	const command = input.command
	const expanded = command.startsWith("~/") ? resolve(homedir(), command.slice(2)) : command
	return {
		command: command.includes("/") ? resolve(cwd, expanded) : command,
		args: input.args == null ? undefined : (input.args as string[]),
		intervalSeconds: interval,
		timeoutSeconds: timeout,
	}
}

export function parseProgress(text: string): ProgressValue {
	const value: unknown = JSON.parse(text)
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a progress object")
	const input = value as Record<string, unknown>
	if (
		typeof input.current !== "number" ||
		!Number.isFinite(input.current) ||
		input.current < 0 ||
		typeof input.total !== "number" ||
		!Number.isFinite(input.total) ||
		input.total <= 0 ||
		input.current > input.total ||
		(input.message != null && typeof input.message !== "string")
	) {
		throw new Error("Expected finite 0 <= current <= total, total > 0, and an optional message string")
	}
	return {
		current: input.current,
		total: input.total,
		message: input.message == null ? undefined : (input.message as string),
	}
}

function clean(text: string): string {
	// Checker output is untrusted display data. Never pass terminal controls through.
	return text
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200)
}

export function formatProgress(label: string, value?: ProgressValue, unavailable = false): string[] {
	const title = clean(label)
	if (!value) return [`${title}: ${unavailable ? "Progress unavailable; still waiting" : "Waiting for progress…"}`]
	const fraction = value.current / value.total
	const filled = Math.round(fraction * 20)
	const message = value.message ? `  · ${clean(value.message)}` : ""
	const status = unavailable ? "  · Progress unavailable (last known value); still waiting" : ""
	return [
		`${title}  ${"█".repeat(filled)}${"░".repeat(20 - filled)}  ${Math.floor(fraction * 100)}%  ${value.current}/${value.total}${message}${status}`,
	]
}

/** Automatic countdown for a timer-only wait; no subprocess or model calls. */
export class TimerProgressMonitor {
	private timer?: ReturnType<typeof setTimeout>
	private stopped = false
	private started?: number
	private readonly seconds: number
	private readonly update: (value: ProgressValue, unavailable: boolean) => void

	constructor(seconds: number, update: (value: ProgressValue, unavailable: boolean) => void) {
		this.seconds = seconds
		this.update = update
	}

	start(): void {
		if (this.stopped || this.started !== undefined) return
		this.started = Date.now()
		const tick = () => {
			if (this.stopped) return
			const elapsed = Math.min(this.seconds, (Date.now() - this.started!) / 1000)
			this.update(
				{
					current: Math.floor(elapsed),
					total: this.seconds,
					message: `${Math.ceil(this.seconds - elapsed)}s remaining`,
				},
				false,
			)
			this.timer = setTimeout(tick, 1000)
		}
		tick()
	}

	stop(): void {
		this.stopped = true
		clearTimeout(this.timer)
	}
}

/** Optional UI-only checker. Never wakes the agent or controls the main event wait. */
export class ProgressMonitor {
	private timer?: ReturnType<typeof setTimeout>
	private interrupt?: () => void
	private stopped = false
	private started = false
	private value?: ProgressValue

	private readonly spec: ProgressSpec
	private readonly cwd: string
	private readonly update: (value: ProgressValue | undefined, unavailable: boolean) => void

	constructor(
		spec: ProgressSpec,
		cwd: string,
		update: (value: ProgressValue | undefined, unavailable: boolean) => void,
	) {
		this.spec = spec
		this.cwd = cwd
		this.update = update
	}

	start(): void {
		if (this.started || this.stopped) return
		this.started = true
		this.update(undefined, false)
		// Return the arming tool result before launching any checker code.
		this.timer = setTimeout(() => this.check(), 0)
	}

	stop(): void {
		if (this.stopped) return
		this.stopped = true
		clearTimeout(this.timer)
		this.interrupt?.()
	}

	private check(): void {
		if (this.stopped) return
		const child = spawn(this.spec.command, this.spec.args ?? [], {
			cwd: this.cwd,
			shell: false,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		})
		let output = ""
		let bytes = 0
		let finished = false
		let deadline: ReturnType<typeof setTimeout> | undefined
		let drain: ReturnType<typeof setTimeout> | undefined
		const terminate = () => {
			if (!child.pid) return
			const kill = (signal: NodeJS.Signals) => {
				try {
					if (process.platform === "win32") child.kill(signal)
					else process.kill(-child.pid!, signal)
				} catch {
					// Process/group already exited.
				}
			}
			kill("SIGTERM")
			setTimeout(() => kill("SIGKILL"), 2000).unref()
		}
		const finish = (success: boolean) => {
			if (finished) return
			finished = true
			clearTimeout(deadline)
			clearTimeout(drain)
			child.stdout?.destroy()
			child.stderr?.destroy()
			// Checkers are short-lived queries, not a place to launch background workers.
			terminate()
			this.interrupt = undefined
			if (this.stopped) return
			const value = success
				? (() => {
						try {
							return parseProgress(output)
						} catch {
							return undefined
						}
					})()
				: undefined
			if (value) this.value = value
			this.update(this.value, !value)
			// A timed-out checker may ignore SIGTERM. Wait for its actual exit before
			// scheduling another query, rather than overlapping during the kill grace period.
			const schedule = () => {
				if (this.stopped) return
				this.timer = setTimeout(() => this.check(), this.spec.intervalSeconds * 1000)
			}
			if (!child.pid || child.exitCode !== null || child.signalCode !== null) return schedule()
			child.once("exit", schedule)
		}
		this.interrupt = () => finish(false)
		deadline = setTimeout(() => finish(false), this.spec.timeoutSeconds * 1000)
		child.stdout!.setEncoding("utf8").on("data", (text: string) => {
			bytes += Buffer.byteLength(text)
			if (bytes > PROGRESS_LIMIT) return finish(false)
			output += text
		})
		child.stderr!.on("data", (buffer: Buffer) => {
			bytes += buffer.length
			if (bytes > PROGRESS_LIMIT) finish(false)
		})
		child.once("error", () => finish(false))
		child.once("exit", (code) => {
			if (finished) return
			// Bound pipe draining even when a descendant inherited stdout/stderr.
			drain = setTimeout(() => finish(code === 0), 250)
		})
		child.once("close", (code) => finish(code === 0))
	}
}
