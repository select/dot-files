import { describe, expect, test } from "bun:test"
import { access, readFile, stat } from "node:fs/promises"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import imageViewer from "./index"
import { chooseImage, cleanup, collectImages, materialize, openArguments, plain } from "./core"

const png = { type: "image", data: "aGVsbG8=", mimeType: "image/png" }
const entry = (id: string, role: string, content: unknown[]) => ({ type: "message", id, message: { role, content } })
const images = collectImages([entry("old", "user", [png]), entry("new", "toolResult", [png, { ...png, mimeType: "image/jpeg" }])])

describe("image collection", () => {
	test("newest messages first, stable block order, without mutating input", () => {
		const entries = [entry("old", "user", [png]), entry("new", "toolResult", [png])]
		expect(collectImages(entries).map((image) => image.label)).toEqual([
			"tool · new · image 1 · image/png", "user · old · image 1 · image/png",
		])
		expect(entries[0].id).toBe("old")
		expect(images[1].mimeType).toBe("image/jpeg")
	})
	test("supports custom messages, ignores non-image content and arbitrary nested details", () => {
		expect(collectImages([
			null, { type: "custom", data: png }, entry("text", "user", [{ type: "text", text: "![image](https://example.test/a.png)" }]),
			{ type: "custom_message", id: "custom", content: [png] },
			entry("invalid", "user", [{ ...png, data: "" }, { ...png, mimeType: "text/plain" }, { ...png, mimeType: "__proto__" }]),
		])).toHaveLength(1)
	})
	test("sanitizes terminal controls in picker labels", () => {
		const [image] = collectImages([entry("id", "user", [{ type: "text", text: "\x1b]8;;bad\x07\nhello" }, png])])
		expect(image.label).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
		expect(plain("a\nb\tc")).toBe("a b c")
	})
	test("chooses latest or a one-based index; rejects invalid arguments", () => {
		expect(chooseImage(images, "latest")).toBe(images[0])
		expect(chooseImage(images, "2")).toBe(images[1])
		for (const argument of ["0", "-1", "1.5", "foo", "99", "01"]) {
			expect(() => chooseImage(images, argument)).toThrow()
		}
	})
})

describe("private files and Herdr arguments", () => {
	test("writes session bytes privately, cleans up idempotently", async () => {
		const file = await materialize(images[0])
		try {
			expect(await readFile(file.path, "utf8")).toBe("hello")
			expect((await stat(file.directory)).mode & 0o777).toBe(0o700)
			expect((await stat(file.path)).mode & 0o777).toBe(0o600)
		} finally {
			await cleanup(file)
			await cleanup(file)
		}
		await expect(access(file.directory)).rejects.toThrow()
	})
	test("rejects unsupported, empty and oversized image data", async () => {
		await expect(materialize({ ...images[0], mimeType: "__proto__" })).rejects.toThrow()
		await expect(materialize({ ...images[0], data: "" })).rejects.toThrow()
		await expect(materialize({ ...images[0], data: "a".repeat(90_000_001) })).rejects.toThrow()
	})
	test("uses explicit caller target and argv, not shell interpolation", () => {
		const args = openArguments({ path: "/tmp/image ;$(touch bad).png", directory: "/tmp" }, "w1:p2")
		expect(args).toContain("--focus")
		// Overlay/popup + --target-pane is rejected by Herdr 0.9.5.
		expect(args[args.indexOf("--placement") + 1]).toBe("zoomed")
		expect(args[args.indexOf("--target-pane") + 1]).toBe("w1:p2")
		expect(args.at(-1)).toBe("PI_IMAGE_VIEWER_FILE=/tmp/image ;$(touch bad).png")
		expect(() => openArguments({ path: "", directory: "" }, "")).toThrow()
	})
})

test("extension cancels picker, opens selected image and cleans launch failures", async () => {
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined
	let code = 0
	let calls = 0
	let path = ""
	const notifications: string[] = []
	const previous = { env: process.env.HERDR_ENV, pane: process.env.HERDR_PANE_ID }
	process.env.HERDR_ENV = "1"
	process.env.HERDR_PANE_ID = "w1:p9"
	try {
		imageViewer({
			registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler },
			exec: async (_command: string, args: string[]) => {
				calls++
				const placement = args[args.indexOf("--placement") + 1]
				if (["overlay", "popup"].includes(placement) && args.includes("--target-pane")) {
					return { code: 1, stdout: "", stderr: "overlay and popup plugin panes target the active pane" }
				}
				path = args.at(-1)!.slice("PI_IMAGE_VIEWER_FILE=".length)
				return { code, stdout: "", stderr: code ? "launch failed" : "" }
			},
		} as unknown as ExtensionAPI)
		const ctx = {
			mode: "tui", sessionManager: { getBranch: () => [entry("a", "user", [png])] },
			ui: { select: async () => undefined, notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionCommandContext
		await handler!("", ctx)
		expect(calls).toBe(0)
		await handler!("latest", ctx)
		expect(calls).toBe(1)
		await access(path) // Ownership passed to viewer; simulate its cleanup.
		await cleanup({ path, directory: path.slice(0, path.lastIndexOf("/")) })
		code = 1
		await handler!("1", ctx)
		await expect(access(path)).rejects.toThrow()
		expect(notifications).toContain("launch failed")
		process.env.HERDR_ENV = "0"
		await handler!("latest", ctx)
		expect(calls).toBe(2)
		expect(notifications.at(-1)).toContain("inside Herdr")
	} finally {
		for (const [key, value] of [["HERDR_ENV", previous.env], ["HERDR_PANE_ID", previous.pane]]) {
			if (value === undefined) delete process.env[key!]
			else process.env[key!] = value
		}
	}
})
