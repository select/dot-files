/**
 * web-fetch pi extension (Lightpanda)
 *
 * A web fetch tool that:
 *   1. Fetches pages via Lightpanda headless browser (JS-capable, AI-optimized)
 *   2. Returns clean markdown directly from Lightpanda's built-in extraction
 *   3. Caches results for 15 minutes to make follow-up questions cheap
 *
 * Requires: ~/.local/bin/lightpanda (install via lightpanda skill)
 */

import { spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent"
import {
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent"
import { type Component, Text, Markdown } from "@mariozechner/pi-tui"
import { type Static, Type } from "@sinclair/typebox"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LIGHTPANDA_BIN = join(homedir(), ".local", "bin", "lightpanda")
const FETCH_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { content: string; timestamp: number }>()

function getCached(url: string): string | null {
	const entry = cache.get(url)
	if (!entry) return null
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		cache.delete(url)
		return null
	}
	return entry.content
}

function setCache(url: string, content: string): void {
	cache.set(url, { content, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): { url: string } | { error: string } {
	const cleaned = raw.startsWith("@") ? raw.slice(1) : raw

	let parsed: URL
	try {
		parsed = new URL(cleaned)
	} catch {
		return { error: `Invalid URL: "${cleaned}". Provide a fully-formed URL, e.g. https://example.com/page` }
	}

	if (parsed.protocol === "http:") parsed.protocol = "https:"

	if (parsed.protocol !== "https:") {
		return { error: `Unsupported scheme: "${parsed.protocol}". Only HTTP/HTTPS are supported.` }
	}

	return { url: parsed.toString() }
}

// ---------------------------------------------------------------------------
// Lightpanda fetch
// ---------------------------------------------------------------------------

function fetchViaLightpanda(url: string, signal?: AbortSignal): Promise<{ markdown: string } | { error: string }> {
	return new Promise((resolve) => {
		const args = [
			"fetch",
			"--dump", "markdown",
			"--wait-until", "networkidle",
			"--wait-ms", String(FETCH_TIMEOUT_MS),
			url,
		]

		const proc = spawn(LIGHTPANDA_BIN, args, {
			stdio: ["ignore", "pipe", "pipe"],
			timeout: FETCH_TIMEOUT_MS + 5000,
		})

		let stdout = ""
		let stderr = ""

		const onAbort = () => proc.kill("SIGTERM")
		signal?.addEventListener("abort", onAbort, { once: true })

		proc.stdout.on("data", (d) => { stdout += d.toString() })
		proc.stderr.on("data", (d) => { stderr += d.toString() })

		proc.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort)
			if (signal?.aborted) return resolve({ error: "Fetch aborted" })
			if (code !== 0) {
				const msg = stderr.trim() || "(no output)"
				return resolve({ error: `Lightpanda exited ${code}: ${msg}` })
			}
			const trimmed = stdout.trim()
			if (!trimmed) return resolve({ error: "Lightpanda returned no content — page may be empty or unsupported" })
			resolve({ markdown: trimmed })
		})

		proc.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort)
			resolve({ error: `Failed to run lightpanda: ${err.message}` })
		})
	})
}

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

const WebFetchParams = Type.Object({
	url: Type.String({
		description: "Fully-formed URL to fetch, e.g. https://example.com/page",
	}),
})

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let cleanupTimer: ReturnType<typeof setInterval> | null = null

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		try {
			await access(LIGHTPANDA_BIN, constants.X_OK)
		} catch {
			ctx.ui.notify(
				`web_fetch: Lightpanda not found at ${LIGHTPANDA_BIN}. Install it via the lightpanda skill (bash scripts/install.sh).`,
				"warning",
			)
		}

		cleanupTimer = setInterval(() => {
			const now = Date.now()
			for (const [url, entry] of cache) {
				if (now - entry.timestamp > CACHE_TTL_MS) cache.delete(url)
			}
		}, 5 * 60 * 1000)
	})

	pi.on("session_shutdown", async (_event: SessionShutdownEvent) => {
		if (cleanupTimer) clearInterval(cleanupTimer)
		cache.clear()
	})

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: [
			"Fetches a web page and returns its main content as markdown.",
			"",
			"Uses Lightpanda headless browser — 9x faster and 16x less memory than",
			"Chrome. Executes JavaScript for dynamic/SPA pages. Returns clean markdown.",
			"Results are cached for 15 minutes — asking follow-up questions about",
			"the same URL is instant.",
			"",
			"URL must include the scheme (https://). Plain http:// is auto-upgraded.",
			"Use the gh CLI (via bash) for GitHub URLs — it is faster and more reliable.",
		].join("\n"),
		parameters: WebFetchParams,

		async execute(
			_id: string,
			params: Static<typeof WebFetchParams>,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult> {
			// 1. Validate URL
			const urlResult = normalizeUrl(params.url)
			if ("error" in urlResult) {
				return { content: [{ type: "text", text: urlResult.error }], isError: true }
			}
			const url = urlResult.url

			// 2. Cache hit
			const cached = getCached(url)
			if (cached) {
				onUpdate?.({ content: [{ type: "text", text: "Cache hit…" }] })
				return buildResult(cached)
			}

			// 3. Fetch via Lightpanda
			onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}…` }] })
			const result = await fetchViaLightpanda(url, signal)
			if ("error" in result) {
				return { content: [{ type: "text", text: result.error }], isError: true }
			}

			// 4. Cache and return
			setCache(url, result.markdown)
			return buildResult(result.markdown)
		},

		renderCall(args: Static<typeof WebFetchParams>, theme: Theme): Component | undefined {
			const url = args.url ?? "…"
			const short = url.length > 72 ? url.slice(0, 72) + "…" : url
			return new Text(
				theme.fg("toolTitle", theme.bold("web_fetch ")) + theme.fg("accent", short),
				0,
				0,
			)
		},

		renderResult(result: AgentToolResult, { expanded }: ToolRenderResultOptions, theme: Theme): Component | undefined {
			if (result.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "(error)"
				return new Text("\n" + theme.fg("error", "✗ ") + theme.fg("error", msg), 0, 0)
			}

			const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)"

			if (expanded) {
				return new Markdown("\n" + text, 0, 0, getMarkdownTheme())
			}

			const lines = text.split("\n")
			const preview = lines.slice(0, 5).join("\n")
			const suffix =
				lines.length > 5
					? theme.fg("muted", `\n… (${lines.length - 5} more lines, Ctrl+O to expand)`)
					: ""
			return new Text("\n" + theme.fg("success", "✓ ") + preview + suffix, 0, 0)
		},
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(markdown: string) {
	const t = truncateHead(markdown, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
	let text = t.content
	if (t.truncated) {
		text += `\n\n[Output truncated: ${t.outputLines} of ${t.totalLines} lines`
		text += ` (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}).]`
		text += `\nCall web_fetch again with a more specific prompt to get targeted information.`
	}
	return { content: [{ type: "text", text }] }
}
