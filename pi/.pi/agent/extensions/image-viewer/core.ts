import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const pluginId = "local.pi-images"
const formats: Record<string, string> = {
	"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
	"image/webp": "webp", "image/bmp": "bmp",
}

export type ConversationImage = { data: string; mimeType: string; label: string }
export type ImageFile = { path: string; directory: string }

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

export function plain(value: string) {
	return value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim()
}

/** Current-branch entries only, newest first; no traversal of details or arbitrary objects. */
export function collectImages(entries: readonly unknown[]): ConversationImage[] {
	const images: ConversationImage[] = []
	for (const entry of [...entries].reverse()) {
		if (!record(entry)) continue
		const message = entry.type === "message" ? entry.message : entry.type === "custom_message" ? entry : undefined
		if (!record(message) || !Array.isArray(message.content)) continue
		const source = message.role === "toolResult" ? String(message.toolName ?? "tool") : String(message.role ?? "message")
		const text = message.content.find((block) => record(block) && block.type === "text" && typeof block.text === "string")
		const caption = record(text) && typeof text.text === "string" ? plain(text.text).slice(0, 100) : ""
		let number = 0
		for (const block of message.content) {
			if (!record(block) || block.type !== "image" || typeof block.data !== "string" ||
				typeof block.mimeType !== "string" || !block.data || !Object.hasOwn(formats, block.mimeType)) continue
			number++
			images.push({
				data: block.data, mimeType: block.mimeType,
				label: plain(`${source} · ${entry.id ?? "live"} · image ${number} · ${block.mimeType}${caption ? " · " + caption : ""}`),
			})
		}
	}
	return images
}

export function chooseImage(images: ConversationImage[], argument: string) {
	if (argument === "latest") return images[0]
	if (!/^[1-9]\d*$/.test(argument)) throw new Error("Usage: /images [latest | number]")
	const image = images[Number(argument) - 1]
	if (!image) throw new Error(`No image ${argument}. There are ${images.length} images in this branch.`)
	return image
}

export async function materialize(image: ConversationImage): Promise<ImageFile> {
	const format = Object.hasOwn(formats, image.mimeType) ? formats[image.mimeType] : undefined
	if (!format) throw new Error("Unsupported image format.")
	if (image.data.length > 90_000_000) throw new Error("Image is too large (maximum 64 MiB).")
	const data = Buffer.from(image.data, "base64")
	if (!data.length || data.length > 64 * 1024 * 1024) throw new Error("Empty or oversized image.")
	const directory = await mkdtemp(join(tmpdir(), "pi-images-"))
	const path = join(directory, `image.${format}`)
	try {
		await writeFile(path, data, { mode: 0o600, flag: "wx" })
		return { path, directory }
	} catch (error) {
		await cleanup({ path, directory })
		throw error
	}
}

export async function cleanup(file: ImageFile) {
	await unlink(file.path).catch(() => {})
	await rmdir(file.directory).catch(() => {})
}

export function openArguments(file: ImageFile, pane: string) {
	if (!pane) throw new Error("Herdr did not supply a caller pane ID.")
	return [
		"plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "viewer",
		// Herdr rejects explicit targets for "overlay"; "zoomed" supports them.
		"--placement", "zoomed", "--target-pane", pane, "--focus",
		"--env", `PI_IMAGE_VIEWER_FILE=${file.path}`,
	]
}
