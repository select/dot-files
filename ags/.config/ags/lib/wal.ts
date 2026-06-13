// Reads pywal colors and exposes named roles + small color helpers.
import GLib from "gi://GLib"
import { readFile, monitorFile } from "ags/file"
import { createState } from "ags"

const PATH = `${GLib.get_user_cache_dir()}/wal/colors.json`

export type Palette = {
	background: string
	foreground: string
	color: string[] // color0..color15
}

const FALLBACK: Palette = {
	background: "#0e0a19",
	foreground: "#c2c1c5",
	color: [
		"#0e0a19", "#95281D", "#DB601B", "#AF414D", "#F39E21", "#18608F", "#DC588C", "#c2c1c5",
		"#60596e", "#95281D", "#DB601B", "#AF414D", "#F39E21", "#18608F", "#DC588C", "#c2c1c5",
	],
}

function parse(): Palette {
	try {
		const json = JSON.parse(readFile(PATH))
		const color = Array.from({ length: 16 }, (_, i) => json.colors[`color${i}`] as string)
		return { background: json.special.background, foreground: json.special.foreground, color }
	} catch {
		return FALLBACK
	}
}

const [palette, setPalette] = createState(parse())

// hot-reload bar colors when wal regenerates them
monitorFile(PATH, () => setPalette(parse()))

export { palette }

// --- color math (hex helpers) ---
function clamp(n: number) {
	return Math.max(0, Math.min(255, Math.round(n)))
}

function rgb(hex: string) {
	const h = hex.replace("#", "")
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function hex(r: number, g: number, b: number) {
	const p = (n: number) => clamp(n).toString(16).padStart(2, "0")
	return `#${p(r)}${p(g)}${p(b)}`
}

export function lighten(color: string, amount: number) {
	const [r, g, b] = rgb(color)
	return hex(r + 255 * amount, g + 255 * amount, b + 255 * amount)
}

export function darken(color: string, amount: number) {
	return lighten(color, -amount)
}

export function alpha(color: string, a: number) {
	const [r, g, b] = rgb(color)
	return `rgba(${r}, ${g}, ${b}, ${a})`
}
