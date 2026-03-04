/**
 * Protected Files Extension
 *
 * Intercepts edit/write tool calls on sensitive files and prompts the user
 * for confirmation before allowing the change. Patterns are loaded from
 * protected-files.json (next to this file).
 *
 * Pattern format in the config:
 *   - Plain string  → treated as a glob-style substring/wildcard match
 *     (supports * as wildcard, matched against the basename)
 *   - "regex:<expr>" → compiled as a RegExp and tested against the full path
 *
 * Controls: ↑↓ navigate • enter select • y allow • n block • esc cancel
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getAgentDir, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, type TUI } from "@mariozechner/pi-tui";
import type { KeybindingsManager, Theme } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface ProtectedFilesConfig {
	patterns: string[];
}

function loadConfig(): RegExp[] {
	const configPath = join(getAgentDir(), "extensions", "protected-files.json");
	let raw: string;
	try {
		raw = readFileSync(configPath, "utf-8");
	} catch {
		console.warn(`[protected-files] config not found at ${configPath}, using no patterns`);
		return [];
	}

	let config: ProtectedFilesConfig;
	try {
		config = JSON.parse(raw) as ProtectedFilesConfig;
	} catch (parseErr) {
		console.warn(`[protected-files] failed to parse config: ${String(parseErr)}`);
		return [];
	}

	return (config.patterns ?? []).map((entry) => {
		if (entry.startsWith("regex:")) {
			return new RegExp(entry.slice("regex:".length));
		}
		// Glob-style: escape special regex chars except *, then turn * into .*
		const escaped = entry.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		return new RegExp(escaped);
	});
}

const PROTECTED_PATTERNS = loadConfig();

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | void> => {
		if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;

		const filePath = event.input.path;
		const isProtected = PROTECTED_PATTERNS.some((p) => p.test(filePath));

		if (!isProtected) return;

		if (!ctx.hasUI) {
			return { block: true, reason: `Write to ${filePath} blocked (no UI for confirmation)` };
		}

		const items: SelectItem[] = [
			{ value: "yes", label: "[Y]es, allow", description: "Permit this edit" },
			{ value: "no", label: "[N]o, block", description: "Reject this edit" },
		];

		const choice = await ctx.ui.custom(
			(tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: string) => void) => {
				const container = new Container();

				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(
					new Text(
						theme.fg("warning", `🔒 Protected file: ${filePath}`) + "\n\nAllow this edit?",
						1,
						1,
					),
				);

				const selectList = new SelectList(items, items.length, {
					selectedPrefix: (t: string) => theme.fg("accent", t),
					selectedText: (t: string) => theme.fg("accent", t),
					description: (t: string) => theme.fg("muted", t),
					scrollInfo: (t: string) => theme.fg("dim", t),
					noMatch: (t: string) => theme.fg("warning", t),
				});
				selectList.onSelect = (item: SelectItem) => done(item.value);
				selectList.onCancel = () => done("no");
				container.addChild(selectList);

				container.addChild(
					new Text(
						theme.fg("dim", "↑↓ navigate • enter select • y allow • n block • esc cancel"),
						1,
						0,
					),
				);
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				container.handleInput = (data: string) => {
					if (data === "y" || data === "Y") {
						done("yes");
					} else if (data === "n" || data === "N") {
						done("no");
					} else {
						selectList.handleInput(data);
						tui.requestRender();
					}
				};

				return container;
			},
		);

		return choice === "yes"
			? undefined
			: { block: true, reason: `Edit to ${filePath} blocked by user` };
	});
}
