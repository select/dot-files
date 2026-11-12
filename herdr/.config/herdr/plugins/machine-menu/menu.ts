import { emitKeypressEvents } from "node:readline"
import { listMachines, plain, toggleMachine, type Machine, type Run } from "./machines"

const run: Run = async (args) => {
	const process = Bun.spawn([Bun.env.HERDR_BIN_PATH || "herdr", ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})
	const [output, error, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	])
	if (code !== 0) throw new Error(error.trim() || output.trim() || `Herdr exited with ${code}`)
	return output
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("Open this menu in a Herdr plugin popup or an interactive terminal.")
	process.exit(1)
}

let machines: Machine[] = []
let selected = 0
let busy = false
let ready = false
let status = "Loading saved machines…"
let failed = false

function render() {
	const width = Math.max(1, (process.stdout.columns || 72) - 2)
	const height = Math.max(1, (process.stdout.rows || 16) - 7)
	const line = (text: string) => Array.from(plain(text)).slice(0, width).join("")
	const start = Math.max(0, Math.min(selected - height + 1, machines.length - height))
	const rows = machines.slice(start, start + height).map((machine, index) => {
		const active = start + index === selected
		const text = line(`${active ? "›" : " "} [${machine.enabled ? "ON " : "OFF"}] ${machine.label}  (${machine.target})`)
		return active ? `\x1b[7m${text}\x1b[0m` : text
	})
	if (!machines.length) rows.push(line(busy ? "  Loading…" : ready ? "  No saved SSH machines." : "  Machine list unavailable."))
	const lines = [
		line("Machines — enable / disable"),
		line("ON = auto-connect; OFF = no reconnect attempts"),
		"",
		...rows,
		"",
		line("↑/↓ or j/k: select · Enter: toggle · R: refresh"),
		line("Esc / Q: close · Remote sessions stay running"),
		`${failed ? "\x1b[31m" : ""}${line(status)}\x1b[0m`,
	]
	process.stdout.write(`\x1b[H\x1b[2J${lines.join("\r\n")}`)
}

async function refresh() {
	const id = machines[selected]?.id
	machines = await listMachines(run)
	const index = machines.findIndex((machine) => machine.id === id)
	selected = index >= 0 ? index : Math.min(selected, Math.max(0, machines.length - 1))
	ready = true
}

async function update(toggle = false) {
	if (busy) return
	busy = true
	failed = false
	const machine = machines[selected]
	status = toggle && machine ? `Updating ${machine.label}…` : "Reading saved machines…"
	render()
	try {
		const message = toggle && machine ? await toggleMachine(run, machine.id) : "Saved machines refreshed."
		await refresh()
		status = message
	} catch (error) {
		ready = false
		failed = true
		status = `${error instanceof Error ? error.message : String(error)} — R to refresh before retrying.`
	} finally {
		busy = false
		render()
	}
}

function close() {
	process.stdin.setRawMode(false)
	process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
	process.exit(0)
}

process.stdout.write("\x1b[?1049h\x1b[?25l")
process.stdin.setRawMode(true)
emitKeypressEvents(process.stdin)
process.stdin.on("keypress", (_text, key: { name?: string; ctrl?: boolean }) => {
	if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
		if (!busy) close()
		return
	}
	if (busy) return
	if (key.name === "up" || key.name === "k") selected = Math.max(0, selected - 1)
	if (key.name === "down" || key.name === "j") selected = Math.min(Math.max(0, machines.length - 1), selected + 1)
	if (key.name === "r") void update()
	if (key.name === "return" && ready && machines.length) void update(true)
	render()
})
process.stdout.on("resize", render)
process.on("SIGTERM", close)
process.on("SIGHUP", close)
process.on("SIGINT", close)
process.stdin.on("end", close)
await update()
