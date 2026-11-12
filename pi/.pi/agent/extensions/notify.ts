/**
 * Desktop Notification Extension
 *
 * Best-effort Linux desktop notifications outside Herdr; silent on headless hosts.
 */

import { execFile } from "child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

/**
 * Herdr owns notifications for managed panes, including remote-to-local delivery.
 * Outside Herdr, notify-send is only useful on a Linux desktop with a session bus.
 */
const canNotify = (): boolean =>
	process.platform === "linux" &&
	process.env.HERDR_ENV !== "1" &&
	Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) &&
	Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);

/**
 * Best-effort desktop notification. Never write asynchronous errors over Pi's editor.
 */
const notify = (title: string, body: string): void => {
	execFile(
		"notify-send",
		[title, body, "--icon=terminal", "--app-name=pi"],
		{ timeout: 3000 },
		() => {
			// Missing executable, notification service, or timed-out D-Bus: stay silent.
		},
	);
};

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
	Boolean(
		part &&
		typeof part === "object" &&
		"type" in part &&
		part.type === "text" &&
		"text" in part,
	);

const extractLastAssistantText = (
	messages: Array<{ role?: string; content?: unknown }>,
): string | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") {
			continue;
		}

		const content = message.content;
		if (typeof content === "string") {
			return content.trim() || null;
		}

		if (Array.isArray(content)) {
			const text = content
				.filter(isTextPart)
				.map((part) => part.text)
				.join("\n")
				.trim();
			return text || null;
		}

		return null;
	}

	return null;
};

const getLastAssistantMessage = (
	messages: Array<{ role?: string; content?: unknown; errorMessage?: string }>,
): { role?: string; content?: unknown; errorMessage?: string } | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === "assistant") {
			return message;
		}
	}
	return null;
};

const plainMarkdownTheme: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: () => "",
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: () => "",
	quote: (text) => text,
	quoteBorder: () => "",
	hr: () => "",
	listBullet: () => "",
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

const simpleMarkdown = (text: string, width = 80): string => {
	const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
	return markdown.render(width).join("\n");
};

const formatNotification = (
	text: string | null,
): { title: string; body: string } => {
	const simplified = text ? simpleMarkdown(text) : "";
	const normalized = simplified.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return { title: "Ready for input", body: "" };
	}

	const maxBody = 200;
	const body =
		normalized.length > maxBody
			? `${normalized.slice(0, maxBody - 1)}…`
			: normalized;
	return { title: "π", body };
};

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (event, ctx) => {
		if (ctx.mode !== "tui" || !canNotify()) return;

		const lastMessage = getLastAssistantMessage(event.messages ?? []);
		if (lastMessage?.errorMessage) {
			const errStr = lastMessage.errorMessage;
			if (
				errStr.includes("RESOURCE_EXHAUSTED") ||
				errStr.includes("Too Many Requests") ||
				errStr.includes("429")
			) {
				return;
			}
		}

		const lastText = extractLastAssistantText(event.messages ?? []);
		const { title, body } = formatNotification(lastText);
		notify(title, body);
	});
}
