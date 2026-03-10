/**
 * Question Tool Extension
 *
 * Unified tool for all interactive question types:
 *
 *   - Confirm (yes/no):    pass only `prompt`
 *   - Single choice:       pass `prompt` + `options`
 *   - Multi-select:        pass `prompt` + `options` + `multiple: true`
 *   - Multi-step:          pass `steps` array
 *
 * Mode is auto-detected from the parameters provided.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"

// ─── Domain Types ─────────────────────────────────────────────────────────────

interface Option {
	value: string
	label: string
	description?: string
}

type RenderOption = Option & { isOther?: boolean }

interface Step {
	id: string
	label?: string
	prompt: string
	options: Option[]
	allowCustom?: boolean
}

interface Answer {
	id: string
	value: string
	label: string
	wasCustom: boolean
	index?: number
}

interface QuestionResult {
	mode: "confirm" | "choice" | "multiselect" | "steps"
	// confirm / choice
	answer?: string | null
	wasCustom?: boolean
	// multiselect
	values?: string[]
	labels?: string[]
	// steps
	answers?: Answer[]
	cancelled: boolean
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const OptionSchema = Type.Object({
	value: Type.String({ description: "Value returned when this option is selected" }),
	label: Type.String({ description: "Display label shown to the user" }),
	description: Type.Optional(Type.String({ description: "Optional hint text shown below the label" })),
})

const StepSchema = Type.Object({
	id: Type.String({ description: "Unique step identifier used as key in the answers map" }),
	label: Type.Optional(Type.String({ description: "Short tab label shown in the tab bar, e.g. 'Scope' or 'Priority'" })),
	prompt: Type.String({ description: "The question text shown to the user for this step" }),
	options: Type.Array(OptionSchema, { description: "Available options to choose from" }),
	allowCustom: Type.Optional(
		Type.Boolean({ description: "Allow a free-text 'Type something' option for this step (default: true)" }),
	),
})

const QuestionParams = Type.Object({
	prompt: Type.Optional(
		Type.String({
			description:
				"Question text. Required for confirm and choice modes. Omit when using `steps`.",
		}),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description:
				"Options for choice mode. When provided together with `prompt`, renders a multiple-choice question. Omit for yes/no confirm.",
		}),
	),
	multiple: Type.Optional(
		Type.Boolean({
			description:
				"When true, renders a multi-select checklist (Space to toggle, Enter to confirm). Requires `prompt` + `options`.",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({
			description:
				"Allow a free-text 'Type something' option in choice mode (default: true). Has no effect in confirm or multi-select mode.",
		}),
	),
	steps: Type.Optional(
		Type.Array(StepSchema, {
			description:
				"Multi-step questions shown in a tab-based interface. When provided, `prompt` and `options` are ignored.",
		}),
	),
})

// ─── Shared Editor Theme ──────────────────────────────────────────────────────

function makeEditorTheme(theme: Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>[1]): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	}
}

// ─── Single Question UI (confirm + choice) ────────────────────────────────────

function runSingleUI(
	ctx: ExtensionContext,
	prompt: string,
	options: Option[],
	allowCustom: boolean,
	isConfirm: boolean,
): Promise<{ value: string; label: string; wasCustom: boolean } | null> {
	const allOptions: RenderOption[] = [...options]
	if (allowCustom) {
		allOptions.push({ value: "__other__", label: "Type something.", isOther: true })
	}

	return ctx.ui.custom<{ value: string; label: string; wasCustom: boolean } | null>(
		(tui, theme, _kb, done) => {
			let optionIndex = 0
			let editMode = false
			let cachedLines: string[] | undefined

			const editor = new Editor(tui, makeEditorTheme(theme))

			editor.onSubmit = (value) => {
				const trimmed = value.trim()
				if (trimmed) {
					done({ value: trimmed, label: trimmed, wasCustom: true })
				} else {
					editMode = false
					editor.setText("")
					refresh()
				}
			}

			function refresh() {
				cachedLines = undefined
				tui.requestRender()
			}

			function handleInput(data: string) {
				if (editMode) {
					if (matchesKey(data, Key.escape)) {
						editMode = false
						editor.setText("")
						refresh()
						return
					}
					editor.handleInput(data)
					refresh()
					return
				}

				// y / n shortcuts for confirm mode
				if (isConfirm) {
					if (data === "y" || data === "Y") {
						done({ value: "yes", label: "Yes", wasCustom: false })
						return
					}
					if (data === "n" || data === "N") {
						done({ value: "no", label: "No", wasCustom: false })
						return
					}
				}

				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1)
					refresh()
					return
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(allOptions.length - 1, optionIndex + 1)
					refresh()
					return
				}

				if (matchesKey(data, Key.enter)) {
					const opt = allOptions[optionIndex]
					if (!opt) return
					if (opt.isOther) {
						editMode = true
						refresh()
					} else {
						done({ value: opt.value, label: opt.label, wasCustom: false })
					}
					return
				}

				if (matchesKey(data, Key.escape)) {
					done(null)
				}
			}

			function render(width: number): string[] {
				if (cachedLines) return cachedLines

				const lines: string[] = []
				const add = (s: string) => lines.push(truncateToWidth(s, width))

				add(theme.fg("accent", "─".repeat(width)))
				add(theme.fg("text", ` ${prompt}`))
				lines.push("")

				for (let i = 0; i < allOptions.length; i++) {
					const opt = allOptions[i]
					const selected = i === optionIndex
					const prefix = selected ? theme.fg("accent", "> ") : "  "
					const color = selected ? "accent" : "text"

					if (opt.isOther && editMode) {
						add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`))
					} else {
						add(prefix + theme.fg(color, `${i + 1}. ${opt.label}`))
					}

					if (opt.description) {
						add(`     ${theme.fg("muted", opt.description)}`)
					}
				}

				if (editMode) {
					lines.push("")
					add(theme.fg("muted", " Your answer:"))
					for (const line of editor.render(width - 2)) {
						add(` ${line}`)
					}
				}

				lines.push("")
				const hint = editMode
					? " Enter to submit • Esc to go back"
					: isConfirm
						? " ↑↓ navigate • Enter confirm • y/n shortcut • Esc cancel"
						: " ↑↓ navigate • Enter select • Esc cancel"
				add(theme.fg("dim", hint))
				add(theme.fg("accent", "─".repeat(width)))

				cachedLines = lines
				return lines
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined
				},
				handleInput,
			}
		},
	)
}

// ─── Multi-Select UI (checkboxes) ────────────────────────────────────────────

function runMultiSelectUI(
	ctx: ExtensionContext,
	prompt: string,
	options: Option[],
): Promise<{ values: string[]; labels: string[] } | null> {
	return ctx.ui.custom<{ values: string[]; labels: string[] } | null>(
		(tui, theme, _kb, done) => {
			let cursorIndex = 0
			const checked = new Set<number>()
			let cachedLines: string[] | undefined

			function refresh() {
				cachedLines = undefined
				tui.requestRender()
			}

			function handleInput(data: string) {
				if (matchesKey(data, Key.up)) {
					cursorIndex = Math.max(0, cursorIndex - 1)
					refresh()
					return
				}
				if (matchesKey(data, Key.down)) {
					cursorIndex = Math.min(options.length - 1, cursorIndex + 1)
					refresh()
					return
				}
				if (matchesKey(data, Key.space)) {
					if (checked.has(cursorIndex)) {
						checked.delete(cursorIndex)
					} else {
						checked.add(cursorIndex)
					}
					refresh()
					return
				}
				if (matchesKey(data, Key.enter)) {
					const selected = Array.from(checked).sort()
					done({
						values: selected.map((i) => options[i].value),
						labels: selected.map((i) => options[i].label),
					})
					return
				}
				if (matchesKey(data, Key.escape)) {
					done(null)
				}
			}

			function render(width: number): string[] {
				if (cachedLines) return cachedLines

				const lines: string[] = []
				const add = (s: string) => lines.push(truncateToWidth(s, width))

				add(theme.fg("accent", "─".repeat(width)))
				add(theme.fg("text", ` ${prompt}`))
				lines.push("")

				for (let i = 0; i < options.length; i++) {
					const opt = options[i]
					const isCursor = i === cursorIndex
					const isChecked = checked.has(i)
					const box = isChecked ? theme.fg("success", "■") : theme.fg("muted", "□")
					const cursor = isCursor ? theme.fg("accent", ">") : " "
					const label = isCursor ? theme.fg("accent", opt.label) : theme.fg("text", opt.label)

					add(` ${cursor} ${box} ${label}`)

					if (opt.description) {
						add(`       ${theme.fg("muted", opt.description)}`)
					}
				}

				lines.push("")
				const selCount = checked.size
				const countStr = selCount === 0 ? "none selected" : `${selCount} selected`
				add(theme.fg("dim", ` ↑↓ navigate • Space toggle • Enter confirm (${countStr}) • Esc cancel`))
				add(theme.fg("accent", "─".repeat(width)))

				cachedLines = lines
				return lines
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined
				},
				handleInput,
			}
		},
	)
}

// ─── Multi-Step UI ────────────────────────────────────────────────────────────

function runStepsUI(
	ctx: ExtensionContext,
	steps: Step[],
): Promise<{ answers: Answer[]; cancelled: boolean }> {
	const totalTabs = steps.length + 1 // steps + Submit

	return ctx.ui.custom<{ answers: Answer[]; cancelled: boolean }>(
		(tui, theme, _kb, done) => {
			let currentTab = 0
			let optionIndex = 0
			let inputMode = false
			let inputStepId: string | null = null
			let cachedLines: string[] | undefined

			const answers = new Map<string, Answer>()
			const editor = new Editor(tui, makeEditorTheme(theme))

			function refresh() {
				cachedLines = undefined
				tui.requestRender()
			}

			function allAnswered() {
				return steps.every((s) => answers.has(s.id))
			}

			function currentStep() {
				return steps[currentTab]
			}

			function currentOptions(): RenderOption[] {
				const s = currentStep()
				if (!s) return []
				const opts: RenderOption[] = [...s.options]
				if (s.allowCustom !== false) {
					opts.push({ value: "__other__", label: "Type something.", isOther: true })
				}
				return opts
			}

			function advanceAfterAnswer() {
				if (currentTab < steps.length - 1) {
					currentTab++
				} else {
					currentTab = steps.length // go to Submit tab
				}
				optionIndex = 0
				refresh()
			}

			function saveAnswer(id: string, value: string, label: string, wasCustom: boolean, index?: number) {
				answers.set(id, { id, value, label, wasCustom, index })
			}

			editor.onSubmit = (value) => {
				if (!inputStepId) return
				const trimmed = value.trim() || "(no response)"
				saveAnswer(inputStepId, trimmed, trimmed, true)
				inputMode = false
				inputStepId = null
				editor.setText("")
				advanceAfterAnswer()
			}

			function handleInput(data: string) {
				if (inputMode) {
					if (matchesKey(data, Key.escape)) {
						inputMode = false
						inputStepId = null
						editor.setText("")
						refresh()
						return
					}
					editor.handleInput(data)
					refresh()
					return
				}

				// Tab / arrow navigation between steps
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
					currentTab = (currentTab + 1) % totalTabs
					optionIndex = 0
					refresh()
					return
				}
				if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
					currentTab = (currentTab - 1 + totalTabs) % totalTabs
					optionIndex = 0
					refresh()
					return
				}

				// Submit tab
				if (currentTab === steps.length) {
					if (matchesKey(data, Key.enter) && allAnswered()) {
						done({ answers: Array.from(answers.values()), cancelled: false })
					} else if (matchesKey(data, Key.escape)) {
						done({ answers: [], cancelled: true })
					}
					return
				}

				// Option navigation
				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1)
					refresh()
					return
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(currentOptions().length - 1, optionIndex + 1)
					refresh()
					return
				}

				// Select option
				if (matchesKey(data, Key.enter)) {
					const step = currentStep()
					if (!step) return
					const opt = currentOptions()[optionIndex]
					if (!opt) return
					if (opt.isOther) {
						inputMode = true
						inputStepId = step.id
						editor.setText("")
						refresh()
						return
					}
					saveAnswer(step.id, opt.value, opt.label, false, optionIndex + 1)
					advanceAfterAnswer()
					return
				}

				if (matchesKey(data, Key.escape)) {
					done({ answers: [], cancelled: true })
				}
			}

			function render(width: number): string[] {
				if (cachedLines) return cachedLines

				const lines: string[] = []
				const add = (s: string) => lines.push(truncateToWidth(s, width))

				add(theme.fg("accent", "─".repeat(width)))

				// Tab bar
				const tabParts: string[] = ["← "]
				for (let i = 0; i < steps.length; i++) {
					const isActive = i === currentTab
					const isAnswered = answers.has(steps[i].id)
					const lbl = steps[i].label || `Q${i + 1}`
					const box = isAnswered ? "■" : "□"
					const tabText = ` ${box} ${lbl} `
					const styled = isActive
						? theme.bg("selectedBg", theme.fg("text", tabText))
						: theme.fg(isAnswered ? "success" : "muted", tabText)
					tabParts.push(`${styled} `)
				}
				const isSubmitTab = currentTab === steps.length
				const canSubmit = allAnswered()
				const submitText = " ✓ Submit "
				const submitStyled = isSubmitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg(canSubmit ? "success" : "dim", submitText)
				tabParts.push(`${submitStyled} →`)
				add(` ${tabParts.join("")}`)
				lines.push("")

				// Submit review tab
				if (isSubmitTab) {
					add(theme.fg("accent", theme.bold(" Ready to submit")))
					lines.push("")
					for (const step of steps) {
						const answer = answers.get(step.id)
						const lbl = step.label || step.id
						if (answer) {
							const prefix = answer.wasCustom ? "(wrote) " : ""
							add(`${theme.fg("muted", ` ${lbl}: `)}${theme.fg("text", prefix + answer.label)}`)
						} else {
							add(theme.fg("warning", ` ${lbl}: unanswered`))
						}
					}
					lines.push("")
					if (canSubmit) {
						add(theme.fg("success", " Press Enter to submit"))
					} else {
						const missing = steps
							.filter((s) => !answers.has(s.id))
							.map((s) => s.label || s.id)
							.join(", ")
						add(theme.fg("warning", ` Unanswered: ${missing}`))
					}
				} else {
					// Question tab
					const step = currentStep()!
					const opts = currentOptions()

					add(theme.fg("text", ` ${step.prompt}`))
					lines.push("")

					for (let i = 0; i < opts.length; i++) {
						const opt = opts[i]
						const selected = i === optionIndex
						const prefix = selected ? theme.fg("accent", "> ") : "  "
						const color = selected ? "accent" : "text"

						if (opt.isOther && inputMode) {
							add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`))
						} else {
							add(prefix + theme.fg(color, `${i + 1}. ${opt.label}`))
						}

						if (opt.description) {
							add(`     ${theme.fg("muted", opt.description)}`)
						}
					}

					if (inputMode) {
						lines.push("")
						add(theme.fg("muted", " Your answer:"))
						for (const line of editor.render(width - 2)) {
							add(` ${line}`)
						}
					}
				}

				lines.push("")
				const hint = inputMode
					? " Enter to submit • Esc to go back"
					: " Tab/←→ switch step • ↑↓ navigate • Enter select • Esc cancel"
				add(theme.fg("dim", hint))
				add(theme.fg("accent", "─".repeat(width)))

				cachedLines = lines
				return lines
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined
				},
				handleInput,
			}
		},
	)
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function question(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask the user a question. Four modes auto-detected from parameters: " +
			"(1) Confirm – pass only `prompt` for a yes/no dialog with y/n shortcuts; " +
			"(2) Choice – pass `prompt` + `options` for a scrollable single-choice list; " +
			"(3) Multi-select – pass `prompt` + `options` + `multiple: true` for a checkbox list where multiple items can be selected; " +
			"(4) Multi-step – pass `steps` for a tab-based sequence of multiple-choice questions with a review/submit screen.",
		parameters: QuestionParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (non-interactive mode)" }],
					details: { mode: "confirm", cancelled: true } as QuestionResult,
				}
			}

			// ── Multi-step mode ──────────────────────────────────────────────
			if (params.steps && params.steps.length > 0) {
				const steps = params.steps as Step[]
				const res = await runStepsUI(ctx, steps)

				if (res.cancelled) {
					return {
						content: [{ type: "text", text: "User cancelled" }],
						details: { mode: "steps", answers: [], cancelled: true } as QuestionResult,
					}
				}

				const lines = res.answers.map((a) => {
					const step = steps.find((s) => s.id === a.id)
					const lbl = step?.label || a.id
					return a.wasCustom ? `${lbl}: user wrote: ${a.value}` : `${lbl}: ${a.index}. ${a.label}`
				})

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { mode: "steps", answers: res.answers, cancelled: false } as QuestionResult,
				}
			}

			// ── Multi-select mode ────────────────────────────────────────────
			if (params.multiple && params.prompt && params.options && params.options.length > 0) {
				const res = await runMultiSelectUI(ctx, params.prompt, params.options as Option[])

				if (!res) {
					return {
						content: [{ type: "text", text: "User cancelled" }],
						details: { mode: "multiselect", values: [], labels: [], cancelled: true } as QuestionResult,
					}
				}

				const summary =
					res.labels.length === 0
						? "User selected nothing"
						: `User selected: ${res.labels.join(", ")}`

				return {
					content: [{ type: "text", text: summary }],
					details: {
						mode: "multiselect",
						values: res.values,
						labels: res.labels,
						cancelled: false,
					} as QuestionResult,
				}
			}

			// ── Choice mode ──────────────────────────────────────────────────
			if (params.prompt && params.options && params.options.length > 0) {
				const allowCustom = params.allowCustom !== false
				const res = await runSingleUI(ctx, params.prompt, params.options as Option[], allowCustom, false)

				if (!res) {
					return {
						content: [{ type: "text", text: "User cancelled" }],
						details: { mode: "choice", answer: null, cancelled: true } as QuestionResult,
					}
				}

				return {
					content: [
						{
							type: "text",
							text: res.wasCustom ? `User wrote: ${res.value}` : `User selected: ${res.label}`,
						},
					],
					details: { mode: "choice", answer: res.value, wasCustom: res.wasCustom, cancelled: false } as QuestionResult,
				}
			}

			// ── Confirm mode (yes/no) ────────────────────────────────────────
			if (params.prompt) {
				const yesNo: Option[] = [
					{ value: "yes", label: "Yes" },
					{ value: "no", label: "No" },
				]
				const res = await runSingleUI(ctx, params.prompt, yesNo, false, true)

				if (!res) {
					return {
						content: [{ type: "text", text: "User cancelled" }],
						details: { mode: "confirm", answer: null, cancelled: true } as QuestionResult,
					}
				}

				return {
					content: [{ type: "text", text: `User answered: ${res.label}` }],
					details: { mode: "confirm", answer: res.value, wasCustom: false, cancelled: false } as QuestionResult,
				}
			}

			// ── No valid params ──────────────────────────────────────────────
			return {
				content: [
					{
						type: "text",
						text: "Error: Provide `prompt` (confirm), `prompt` + `options` (choice), or `steps` (multi-step).",
					},
				],
				details: { mode: "confirm", cancelled: true } as QuestionResult,
			}
		},

		// ── renderCall ──────────────────────────────────────────────────────
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("question "))

			if (args.steps) {
				const count = (args.steps as Step[]).length
				const labels = (args.steps as Step[]).map((s: Step) => s.label || s.id).join(", ")
				text += theme.fg("muted", `${count} step${count !== 1 ? "s" : ""}`)
				if (labels) text += theme.fg("dim", ` (${truncateToWidth(labels, 50)})`)
			} else if (args.options && args.multiple) {
				text += theme.fg("muted", String(args.prompt ?? ""))
				const labels = (args.options as Option[]).map((o: Option) => o.label)
				text += theme.fg("dim", ` [multi-select]\n  ${labels.map((l, i) => `${i + 1}. ${l}`).join(", ")}`)
			} else if (args.options) {
				text += theme.fg("muted", String(args.prompt ?? ""))
				const labels = (args.options as Option[]).map((o: Option) => o.label)
				text += theme.fg("dim", `\n  ${labels.map((l, i) => `${i + 1}. ${l}`).join(", ")}`)
			} else {
				text += theme.fg("muted", String(args.prompt ?? ""))
				text += theme.fg("dim", " [yes/no]")
			}

			return new Text(text, 0, 0)
		},

		// ── renderResult ────────────────────────────────────────────────────
		renderResult(result, _options, theme) {
			const details = result.details as QuestionResult | undefined

			if (!details) {
				const t = result.content[0]
				return new Text(t?.type === "text" ? t.text : "", 0, 0)
			}

			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0)
			}

			// Multi-step
			if (details.mode === "steps" && details.answers) {
				const lines = details.answers.map((a) => {
					const prefix = a.wasCustom ? theme.fg("muted", "(wrote) ") : ""
					const display = a.wasCustom ? a.value : a.index ? `${a.index}. ${a.label}` : a.label
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${prefix}${display}`
				})
				return new Text(lines.join("\n"), 0, 0)
			}

			// Multi-select
			if (details.mode === "multiselect") {
				if (!details.labels || details.labels.length === 0) {
					return new Text(theme.fg("muted", "✓ (nothing selected)"), 0, 0)
				}
				const items = details.labels.map((l) => `${theme.fg("success", "■")} ${theme.fg("accent", l)}`).join("  ")
				return new Text(items, 0, 0)
			}

			// Confirm / Choice
			if (details.answer === null || details.answer === undefined) {
				return new Text(theme.fg("warning", "No answer"), 0, 0)
			}

			const prefix = details.wasCustom ? theme.fg("muted", "(wrote) ") : ""
			return new Text(theme.fg("success", "✓ ") + prefix + theme.fg("accent", details.answer), 0, 0)
		},
	})
}
