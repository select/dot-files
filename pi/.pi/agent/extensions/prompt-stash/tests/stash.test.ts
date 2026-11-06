import { describe, expect, test } from "bun:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import stash from "../index"

function setup() {
	let text = ""
	let widget: string[] | undefined
	let shortcut = ""
	let handler: (ctx: ExtensionContext) => Promise<void>
	let beforeStart: (event: unknown, ctx: ExtensionContext) => Promise<void>
	stash({
		registerShortcut(key: string, options: { handler: typeof handler }) {
			shortcut = key
			handler = options.handler
		},
		on(event: string, callback: typeof beforeStart) {
			expect(event).toBe("before_agent_start")
			beforeStart = callback
		},
	} as unknown as ExtensionAPI)
	const ctx = {
		hasUI: true,
		ui: {
			getEditorText: () => text,
			setEditorText: (value: string) => { text = value },
			setWidget: (_key: string, value: string[] | undefined) => { widget = value },
			theme: { fg: (_color: string, value: string) => value },
		},
	} as unknown as ExtensionContext
	return {
		ctx,
		shortcut,
		get text() { return text },
		set text(value: string) { text = value },
		get widget() { return widget },
		press: () => handler(ctx),
		start: () => beforeStart({}, ctx),
	}
}

describe("vendored prompt stash", () => {
	test("Ctrl+S restores multiline drafts LIFO and clears the widget", async () => {
		const ui = setup()
		expect(ui.shortcut).toBe("ctrl+s")
		ui.text = "first draft\nsecond line"
		await ui.press()
		expect(ui.text).toBe("")
		expect(ui.widget?.[0]).toContain("ctrl+s to restore")
		ui.text = "second draft"
		await ui.press()
		expect(ui.widget?.[0]).toContain("(+1 more)")
		await ui.press()
		expect(ui.text).toBe("second draft")
		ui.text = ""
		await ui.press()
		expect(ui.text).toBe("first draft\nsecond line")
		expect(ui.widget).toBeUndefined()
	})

	test("auto-restore waits for an empty editor without overwriting a new draft", async () => {
		const ui = setup()
		ui.text = "parked draft"
		await ui.press()
		ui.text = "new draft"
		await ui.start()
		expect(ui.text).toBe("new draft")
		expect(ui.widget).toBeDefined()
		ui.text = ""
		await ui.start()
		expect(ui.text).toBe("parked draft")
		expect(ui.widget).toBeUndefined()
		ui.text = ""
		await ui.start()
		expect(ui.text).toBe("")
	})

	test("empty stash is a no-op", async () => {
		const ui = setup()
		await ui.press()
		expect(ui.text).toBe("")
		expect(ui.widget).toBeUndefined()
	})

	test("headless handlers do not read or write the editor", async () => {
		const ui = setup()
		ui.ctx.hasUI = false
		ui.text = "leave alone"
		await ui.press()
		await ui.start()
		expect(ui.text).toBe("leave alone")
		expect(ui.widget).toBeUndefined()
	})
})
