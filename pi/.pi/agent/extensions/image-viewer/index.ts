import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { chooseImage, cleanup, collectImages, materialize, openArguments } from "./core"

export default function imageViewer(pi: ExtensionAPI) {
	let busy = false
	pi.registerCommand("images", {
		description: "Open a conversation image fullscreen in Herdr: /images [latest | number]",
		handler: async (args, ctx) => {
			if (busy) return
			busy = true
			try {
				if (ctx.mode !== "tui" || process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
					throw new Error("/images requires interactive Pi inside Herdr.")
				}
				const images = collectImages(ctx.sessionManager.getBranch())
				if (!images.length) {
					ctx.ui.notify("No supported images in the current conversation branch.", "info")
					return
				}
				const argument = args.trim()
				const selected = argument ? chooseImage(images, argument) : await (async () => {
					const labels = images.map((image, index) => `${index + 1}. ${image.label}`)
					const choice = await ctx.ui.select("Open image — newest first", labels)
					return choice ? images[labels.indexOf(choice)] : undefined
				})()
				if (!selected) return
				const file = await materialize(selected)
				try {
					const result = await pi.exec(process.env.HERDR_BIN_PATH || "herdr",
						openArguments(file, process.env.HERDR_PANE_ID))
					if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() ||
						"Could not open the image viewer. Link the local.pi-images Herdr plugin first.")
					// The viewer now owns the private file and removes it when it exits.
				} catch (error) {
					await cleanup(file)
					throw error
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
			} finally {
				busy = false
			}
		},
	})
}
