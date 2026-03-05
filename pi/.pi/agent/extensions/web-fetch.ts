/**
 * web-fetch pi extension
 *
 * A simple, self-contained web fetch tool that:
 *   1. Fetches pages via Node's built-in fetch (no puppeteer / Chromium required)
 *   2. Extracts clean markdown via `uvx trafilatura` (ML-based boilerplate removal)
 *   3. Falls back to basic HTML stripping if trafilatura is unavailable
 *   4. Caches results for 15 minutes to make follow-up questions cheap
 *
 * Inspired by https://github.com/georgebashi/pi-web-fetch
 */

import { spawn } from "node:child_process"
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
	// Some models prepend "@"
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
// HTTP fetch
// ---------------------------------------------------------------------------

async function fetchHtml(url: string, signal?: AbortSignal): Promise<{ html: string } | { error: string }> {
	try {
		const res = await fetch(url, {
			signal,
			headers: {
				"User-Agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
			redirect: "follow",
		})

		if (!res.ok) {
			return { error: `HTTP ${res.status} ${res.statusText} for ${url}` }
		}

		const contentType = res.headers.get("content-type") ?? ""
		if (!contentType.includes("html") && !contentType.includes("text") && !contentType.includes("xml")) {
			return { error: `Unexpected content-type "${contentType}" — web_fetch only handles HTML pages.` }
		}

		const html = await res.text()
		return { html }
	} catch (err: any) {
		if (err.name === "AbortError") return { error: "Fetch aborted" }
		return { error: `Fetch failed: ${err.message}` }
	}
}

// ---------------------------------------------------------------------------
// HTML → Markdown via trafilatura (uvx / uv run)
// ---------------------------------------------------------------------------

interface Runner {
	cmd: string
	args: () => string[]
}

const RUNNERS: Runner[] = [
	{ cmd: "uvx", args: () => ["trafilatura", "--markdown", "--formatting"] },
	{
		cmd: "uv",
		args: () => ["run", "--with", "trafilatura", "trafilatura", "--markdown", "--formatting"],
	},
	{ cmd: "pipx", args: () => ["run", "trafilatura", "--markdown", "--formatting"] },
]

let detectedRunner: Runner | null = null
let runnerChecked = false

async function detectRunner(execFn: ExtensionAPI["exec"]): Promise<Runner | null> {
	if (runnerChecked) return detectedRunner
	runnerChecked = true
	for (const r of RUNNERS) {
		try {
			const res = await execFn(r.cmd, ["--version"], { timeout: 5000 })
			if (res.code === 0) {
				detectedRunner = r
				return r
			}
		} catch {
			// try next
		}
	}
	return null
}

function extractViaTrafilatura(html: string, runner: Runner, signal?: AbortSignal): Promise<{ markdown: string } | { error: string }> {
	return new Promise((resolve) => {
		const proc = spawn(runner.cmd, runner.args(), { stdio: ["pipe", "pipe", "pipe"] })
		let stdout = ""
		let stderr = ""

		const onAbort = () => {
			proc.kill("SIGTERM")
		}
		signal?.addEventListener("abort", onAbort, { once: true })

		proc.stdout.on("data", (d) => { stdout += d.toString() })
		proc.stderr.on("data", (d) => { stderr += d.toString() })

		proc.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort)
			if (signal?.aborted) return resolve({ error: "Aborted" })
			if (code !== 0) return resolve({ error: `trafilatura exited ${code}: ${stderr.trim() || "(no output)"}` })
			const trimmed = stdout.trim()
			if (!trimmed) return resolve({ error: "trafilatura returned no content — page may be empty or unsupported" })
			resolve({ markdown: trimmed })
		})

		proc.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort)
			resolve({ error: `Failed to run ${runner.cmd}: ${err.message}` })
		})

		proc.stdin.write(html)
		proc.stdin.end()
	})
}

// ---------------------------------------------------------------------------
// Fallback: simple HTML → text stripping
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
	// Remove <script>, <style>, <nav>, <header>, <footer> blocks
	let text = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		// Convert common block elements to newlines
		.replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		// Strip remaining tags
		.replace(/<[^>]+>/g, "")
		// Decode common HTML entities
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		// Collapse whitespace
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()

	return text
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
		const runner = await detectRunner(pi.exec.bind(pi))
		if (!runner) {
			ctx.ui.notify(
				"web_fetch: no Python runner found (uv/uvx, pipx). HTML extraction will use basic tag stripping as fallback.",
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
			"Uses Node.js built-in fetch (no browser required) and trafilatura for",
			"ML-based boilerplate removal. Falls back to basic HTML stripping.",
			"Results are cached for 15 minutes — asking follow-up questions about",
			"the same URL is instant.",
			"",
			"URL must include the scheme (https://). Plain http:// is auto-upgraded.",
			"Use the gh CLI (via bash) for GitHub URLs — it is faster and more reliable.",
		].join("\n"),
		parameters: WebFetchParams,

		async execute(_id: string, params: Static<typeof WebFetchParams>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback | undefined, _ctx: ExtensionContext): Promise<AgentToolResult> {
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

			// 3. Fetch HTML
			onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}…` }] })
			const fetchResult = await fetchHtml(url, signal)
			if ("error" in fetchResult) {
				return { content: [{ type: "text", text: fetchResult.error }], isError: true }
			}

			// 4. Extract content
			onUpdate?.({ content: [{ type: "text", text: "Extracting content…" }] })
			let markdown: string

			if (detectedRunner) {
				const extracted = await extractViaTrafilatura(fetchResult.html, detectedRunner, signal)
				if ("markdown" in extracted) {
					markdown = extracted.markdown
				} else {
					// trafilatura failed at runtime — warn and fall back
					markdown = stripHtml(fetchResult.html)
					markdown += `\n\n⚠️ trafilatura extraction failed (${extracted.error}). Content above is from basic HTML stripping.`
				}
			} else {
				markdown = stripHtml(fetchResult.html)
			}

			// 5. Cache and return
			setCache(url, markdown)
			return buildResult(markdown)
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
