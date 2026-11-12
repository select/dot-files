import { spawnSync } from "node:child_process"
import { lstat, realpath, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname } from "node:path"
import { emitKeypressEvents } from "node:readline"

const file = process.env.PI_IMAGE_VIEWER_FILE
let owned = false
let active = false

async function main() {
	if (!file) throw new Error("Open an image using Pi's /images command.")
	// Only consume the private, single-file directories created by the extension.
	const directory = dirname(file)
	const parent = await realpath(dirname(directory))
	const temporary = await realpath(tmpdir())
	const info = await lstat(directory)
	const image = await lstat(file)
	if (parent !== temporary || !/^pi-images-[a-zA-Z0-9]+$/.test(basename(directory)) ||
		!/^image\.(png|jpg|gif|webp|bmp)$/.test(basename(file)) ||
		!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
		!image.isFile() || image.isSymbolicLink() || (image.mode & 0o077) !== 0 ||
		(typeof process.getuid === "function" && (info.uid !== process.getuid() || image.uid !== process.getuid()))) {
		throw new Error("Refusing an image outside a private Pi image directory.")
	}
	owned = true
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("The image viewer requires a terminal.")
	const available = spawnSync("kitten", ["icat", "--help"], { encoding: "utf8", timeout: 5000 })
	if (available.error || available.status !== 0) throw new Error("Install kitty's kitten utility to display images.")

	process.stdout.write("\x1b[?1049h\x1b[?25l")
	active = true
	// kitten uses the terminal's pixel size when available. Derive a stable cell
	// size once, then use it for resize without competing for stdin responses.
	const size = spawnSync("kitten", ["icat", "--stdin=no", "--detection-timeout=1", "--print-window-size"],
		{ encoding: "utf8", timeout: 2000 })
	const pixels = /^(\d+)x(\d+)\s*$/.exec(size.stdout?.trim() || "")
	const cellWidth = pixels ? Math.max(1, Number(pixels[1]) / (process.stdout.columns || 80)) : 10
	const cellHeight = pixels ? Math.max(1, Number(pixels[2]) / (process.stdout.rows || 24)) : 20

	function render() {
		const width = Math.max(1, process.stdout.columns || 80)
		const height = Math.max(3, process.stdout.rows || 24)
		process.stdout.write("\x1b_Ga=d,d=A\x1b\\\x1b[H\x1b[2J")
		process.stdout.write("Pi image — fit to screen".slice(0, width - 1))
		const result = spawnSync("kitten", [
			"icat", "--stdin=no", "--transfer-mode=stream", "--passthrough=none",
			"--use-window-size", `${width},${height},${Math.round(width * cellWidth)},${Math.round(height * cellHeight)}`,
			"--place", `${width}x${height - 2}@0x1`, "--scale-up", "--loop=0", file!,
		], { stdio: ["ignore", "inherit", "pipe"], timeout: 10000 })
		const status = result.status === 0 ? "Esc / Q: return · R: redraw" :
			"Cannot display image (kitten icat failed). Esc / Q: return"
		process.stdout.write(`\x1b[${height};1H${status.slice(0, width - 1)}`)
	}
	render()
	process.stdin.setRawMode(true)
	emitKeypressEvents(process.stdin)
	await new Promise<void>((resolve) => {
		const finish = () => resolve()
		process.stdin.on("keypress", (_text, key: { name?: string; ctrl?: boolean }) => {
			if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish()
			if (key.name === "r") render()
		})
		process.stdout.on("resize", render)
		process.on("SIGTERM", finish)
		process.on("SIGHUP", finish)
		process.on("SIGINT", finish)
		process.stdin.on("end", finish)
		process.stdin.resume()
	})
}

try {
	await main()
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
} finally {
	if (active) {
		process.stdin.setRawMode(false)
		process.stdin.pause()
		process.stdout.write("\x1b_Ga=d,d=A\x1b\\\x1b[0m\x1b[?25h\x1b[?1049l")
	}
	if (owned && file) {
		await unlink(file).catch(() => {})
		await rmdir(dirname(file)).catch(() => {})
	}
}
// Terminal listeners must not keep this transient pane alive after dismissal.
process.exit(process.exitCode || 0)
