#!/usr/bin/env bun
/**
 * Aikido Security CLI helper for agents.
 *
 * Credentials (OAuth2 client credentials, created by a workspace admin at
 * https://app.aikido.dev/settings/integrations/api/aikido/rest):
 *   env: AIKIDO_CLIENT_ID / AIKIDO_CLIENT_SECRET  (+ optional AIKIDO_API_URL)
 *   or:  ~/.config/aikido/credentials.json  { "clientId": "...", "clientSecret": "...", "apiUrl": "..." }
 *
 * Commands:
 *   pr <owner/repo#123 | url | 123>   Aikido check runs on a PR + scan detail + repo findings
 *   scan <scanId>                     PR check (CI scan) metadata by id
 *   scans [--repo-id N] [--search S]  List recent PR checks
 *   repos [search]                    List code repositories (id + name)
 *   issues --repo <name|id> [...]     Export issues for a repo
 *   groups [--repo-id N]              List open issue groups
 *   group <groupId>                   Issue group detail
 *   issue <issueId>                   Single issue detail
 *   get <path>                        Raw GET against /api/public/v1 (exploration escape hatch)
 *
 * Common flags: --json, --severities critical,high --status open --limit N --out FILE
 */

import { writeFile, mkdir, readFile } from "fs/promises"
import { join, dirname } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"

type Creds = { clientId: string; clientSecret: string; apiUrl: string }

const CRED_FILE = join(homedir(), ".config", "aikido", "credentials.json")
const TOKEN_CACHE = join(homedir(), ".cache", "aikido", "token.json")

async function loadCreds(soft = false): Promise<Creds | null> {
	const apiUrl = (process.env.AIKIDO_API_URL ?? "https://app.aikido.dev").replace(/\/$/, "")
	if (process.env.AIKIDO_CLIENT_ID && process.env.AIKIDO_CLIENT_SECRET)
		return { clientId: process.env.AIKIDO_CLIENT_ID, clientSecret: process.env.AIKIDO_CLIENT_SECRET, apiUrl }

	const file = await readFile(CRED_FILE, "utf-8").catch(() => null)
	if (file) {
		const parsed = JSON.parse(file)
		if (parsed.clientId && parsed.clientSecret)
			return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, apiUrl: parsed.apiUrl ?? apiUrl }
	}

	if (soft) return null
	console.error("❌ Aikido API credentials not found.")
	console.error("   Set AIKIDO_CLIENT_ID / AIKIDO_CLIENT_SECRET, or create " + CRED_FILE)
	console.error("   Create credentials: https://app.aikido.dev/settings/integrations/api/aikido/rest")
	console.error("   Scopes needed: reports:read, issues:read, repositories:read, code_quality:read")
	process.exit(2)
}

async function accessToken(creds: Creds): Promise<string> {
	const cached = await readFile(TOKEN_CACHE, "utf-8")
		.then((raw) => JSON.parse(raw))
		.catch(() => null)
	if (cached?.token && cached.apiUrl === creds.apiUrl && cached.expiresAt > Date.now() + 30_000) return cached.token

	const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")
	const res = await fetch(`${creds.apiUrl}/api/oauth/token`, {
		method: "POST",
		headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
		body: JSON.stringify({ grant_type: "client_credentials" }),
	})
	if (!res.ok) {
		console.error(`❌ Token request failed: ${res.status} ${await res.text()}`)
		process.exit(2)
	}
	const data = (await res.json()) as { access_token: string; expires_in?: number }
	await mkdir(dirname(TOKEN_CACHE), { recursive: true })
	await writeFile(
		TOKEN_CACHE,
		JSON.stringify({
			token: data.access_token,
			apiUrl: creds.apiUrl,
			expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		}),
		{ mode: 0o600 },
	)
	return data.access_token
}

type ApiResult = { ok: boolean; status: number; data: unknown }

async function api(path: string, query: Record<string, string | number | undefined> = {}): Promise<ApiResult> {
	const creds = (await loadCreds()) as Creds
	const token = await accessToken(creds)
	const url = new URL(`${creds.apiUrl}/api/public/v1${path.startsWith("/") ? path : `/${path}`}`)
	for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v))
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
	const text = await res.text()
	const data = text ? tryJson(text) : null
	return { ok: res.ok, status: res.status, data }
}

function tryJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

function gh(args: string[]): unknown {
	const out = execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }).trim()
	return out ? tryJson(out) : null
}

function parsePr(input: string): { owner: string; repo: string; number: number } {
	const url = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
	if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) }
	const short = input.match(/^([^/]+)\/([^#]+)#(\d+)$/)
	if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) }
	const num = input.match(/^#?(\d+)$/)
	if (num) {
		const nwo = String(gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]))
		const [owner, repo] = nwo.split("/")
		return { owner, repo, number: Number(num[1]) }
	}
	console.error(`❌ Unrecognised PR reference: ${input}`)
	process.exit(1)
}

type CheckRun = { name: string; conclusion: string; details_url: string; output?: { summary?: string; title?: string } }

function severitiesFromSummary(summary: string) {
	const news = [...summary.matchAll(/(\d+)\s+new\s+(CRITICAL|HIGH|MEDIUM|LOW)/gi)].map((m) => ({
		count: Number(m[1]),
		severity: m[2].toLowerCase(),
	}))
	const solved = [...summary.matchAll(/(\d+)\s+(CRITICAL|HIGH|MEDIUM|LOW)\s+issues?\s+(?:was|were)\s+solved/gi)].map((m) => ({
		count: Number(m[1]),
		severity: m[2].toLowerCase(),
	}))
	return { new: news, solved }
}

const flags = new Map<string, string>()
const positional: string[] = []
{
	const argv = process.argv.slice(2)
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (!a.startsWith("--")) {
			positional.push(a)
			continue
		}
		const eq = a.indexOf("=")
		if (eq > -1) flags.set(a.slice(2, eq), a.slice(eq + 1))
		else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.set(a.slice(2), argv[++i])
		else flags.set(a.slice(2), "true")
	}
}
const wantJson = flags.has("json")
const limit = Number(flags.get("limit") ?? 25)

async function emit(markdown: string, data: unknown) {
	const body = wantJson ? JSON.stringify(data, null, 2) : markdown
	const out = flags.get("out")
	if (out) {
		await mkdir(dirname(out), { recursive: true })
		await writeFile(out, body)
		console.log(`✅ Written to ${out}`)
		return
	}
	console.log(body)
}

async function findScan(scanId: number, repoId?: number) {
	// /report/ciScans has no single-scan endpoint, so page until the id shows up.
	for (let page = 0; page < 20; page++) {
		const res = await api("/report/ciScans", { page, per_page: 50, filter_code_repo_id: repoId })
		if (!res.ok) return { error: res, scan: null as unknown }
		const list = (res.data as { scan_id: number }[]) ?? []
		if (!list.length) break
		const hit = list.find((s) => Number(s.scan_id) === scanId)
		if (hit) return { error: null, scan: hit }
	}
	return { error: null, scan: null as unknown }
}

async function cmdPr(ref: string) {
	const { owner, repo, number } = parsePr(ref)
	const pr = gh([
		"pr",
		"view",
		String(number),
		"--repo",
		`${owner}/${repo}`,
		"--json",
		"title,headRefName,headRefOid,url",
	]) as { title: string; headRefName: string; headRefOid: string; url: string }

	const pages = gh([
		"api",
		`repos/${owner}/${repo}/commits/${pr.headRefOid}/check-runs?per_page=100`,
		"--paginate",
		"--slurp",
	]) as { check_runs: (CheckRun & { app?: { slug?: string } })[] }[]
	const checks: CheckRun[] = (Array.isArray(pages) ? pages : [pages])
		.flatMap((p) => p?.check_runs ?? [])
		.filter((c) => c.app?.slug === "aikido-security" || /aikido/i.test(c.name ?? ""))
		.map((c) => ({ name: c.name, conclusion: c.conclusion, details_url: c.details_url, output: c.output }))

	const scans = checks
		.map((c) => Number(c.details_url?.match(/\/featurebranch\/scan\/(\d+)/)?.[1]))
		.filter((n) => Number.isFinite(n))

	const detail: Record<string, unknown> = {}
	let apiNote = ""
	if (!flags.has("no-api") && scans.length) {
		const creds = await loadCreds(true)
		if (creds) {
			const repos = await api("/repositories/code", { per_page: 50, filter_name: repo })
			const match = (repos.data as { id: number; name: string }[] | undefined)?.find((r) =>
				r.name?.toLowerCase().includes(repo.toLowerCase()),
			)
			detail.repository = match ?? null
			for (const scanId of scans) {
				const found = await findScan(scanId, match?.id)
				detail[`scan_${scanId}`] = found.scan ?? { note: "not found in /report/ciScans (older than 1000 checks?)" }
				if (found.error) apiNote = `API error ${found.error.status}: ${JSON.stringify(found.error.data).slice(0, 300)}`
			}
			if (match) {
				const groups = await api("/open-issue-groups", { per_page: limit, filter_code_repo_id: match.id })
				detail.open_issue_groups = groups.ok ? groups.data : { error: groups.status, data: groups.data }
			}
		} else apiNote = "No Aikido API credentials configured — GitHub-only output."
	}

	const lines: string[] = []
	lines.push(`# Aikido — ${owner}/${repo}#${number}`)
	lines.push("")
	lines.push(`- PR: ${pr.url} (\`${pr.headRefName}\`, commit \`${pr.headRefOid.slice(0, 10)}\`)`)
	lines.push(`- Title: ${pr.title}`)
	lines.push("")
	if (!checks.length) lines.push("_No Aikido check runs found on the head commit._")
	for (const c of checks) {
		const summary = c.output?.summary ?? ""
		const sev = severitiesFromSummary(summary)
		lines.push(`## ${c.name} — ${c.conclusion}`)
		lines.push(`- Scan: ${c.details_url}`)
		if (sev.new.length) lines.push(`- New: ${sev.new.map((s) => `${s.count} ${s.severity}`).join(", ")}`)
		if (sev.solved.length) lines.push(`- Solved: ${sev.solved.map((s) => `${s.count} ${s.severity}`).join(", ")}`)
		if (summary) {
			lines.push("- Raw summary:")
			lines.push("")
			lines.push("```")
			lines.push(summary)
			lines.push("```")
		}
		lines.push("")
	}
	if (Object.keys(detail).length) {
		lines.push("## Aikido API detail")
		lines.push("")
		lines.push("```json")
		lines.push(JSON.stringify(detail, null, 2))
		lines.push("```")
		lines.push("")
	}
	if (apiNote) lines.push(`> ${apiNote}`)
	lines.push("")
	lines.push(
		"> Note: the public API exposes PR-check *counts*, not the per-scan finding list. For the exact new findings open the scan URL (browser session required) or correlate with the repo issues below.",
	)

	await emit(lines.join("\n"), { pr, checks, detail, note: apiNote })
}

async function cmdScan(scanId: string) {
	const repoId = flags.get("repo-id") ? Number(flags.get("repo-id")) : undefined
	const found = await findScan(Number(scanId), repoId)
	if (found.error) fail(found.error)
	if (!found.scan) {
		console.error(`❌ Scan ${scanId} not found in the last 1000 PR checks. Try --repo-id <id>.`)
		process.exit(1)
	}
	await emit(["# Aikido PR check " + scanId, "", "```json", JSON.stringify(found.scan, null, 2), "```"].join("\n"), found.scan)
}

function fail(res: ApiResult): never {
	console.error(`❌ API ${res.status}: ${typeof res.data === "string" ? res.data : JSON.stringify(res.data).slice(0, 500)}`)
	process.exit(1)
}

function table(rows: Record<string, unknown>[], cols: string[]) {
	if (!rows.length) return "_none_"
	const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`
	const body = rows
		.map((r) => `| ${cols.map((c) => String(r[c] ?? "").replace(/\n/g, " ").slice(0, 120)).join(" | ")} |`)
		.join("\n")
	return `${head}\n${body}`
}

async function main() {
	const cmd = positional[0]
	switch (cmd) {
		case "pr":
			return cmdPr(positional[1] ?? "")
		case "scan":
			return cmdScan(positional[1] ?? "")
		case "scans": {
			const res = await api("/report/ciScans", {
				per_page: Math.min(limit, 50),
				page: Number(flags.get("page") ?? 0),
				filter_code_repo_id: flags.get("repo-id"),
				filter_gate_status: flags.get("gate-status"),
				search: flags.get("search"),
			})
			if (!res.ok) fail(res)
			const rows = res.data as Record<string, unknown>[]
			return emit(
				"# Aikido PR checks\n\n" +
					table(rows, [
						"scan_id",
						"gate_status",
						"new_issues_count",
						"solved_issues_count",
						"code_repo_name",
						"branch_name",
						"pull_request_url",
					]),
				rows,
			)
		}
		case "repos": {
			const res = await api("/repositories/code", { per_page: Math.min(limit, 100), filter_name: positional[1] })
			if (!res.ok) fail(res)
			const rows = res.data as Record<string, unknown>[]
			return emit("# Aikido code repositories\n\n" + table(rows, ["id", "name", "provider", "active"]), rows)
		}
		case "issues": {
			const repo = flags.get("repo")
			const res = await api("/issues/export", {
				format: "json",
				filter_status: flags.get("status") ?? "open",
				filter_severities: flags.get("severities"),
				filter_issue_type: flags.get("type"),
				filter_code_repo_id: repo && /^\d+$/.test(repo) ? repo : undefined,
				filter_code_repo_name: repo && !/^\d+$/.test(repo) ? repo : undefined,
				per_page: Math.min(limit, 100),
				page: Number(flags.get("page") ?? 0),
			})
			if (!res.ok) fail(res)
			const rows = (res.data as Record<string, unknown>[]).slice(0, limit)
			return emit(
				"# Aikido issues\n\n" +
					table(rows, ["id", "severity", "type", "attack_surface", "rule", "affected_package", "affected_file", "status"]),
				res.data,
			)
		}
		case "groups": {
			const res = await api("/open-issue-groups", {
				per_page: Math.min(limit, 100),
				page: Number(flags.get("page") ?? 0),
				filter_code_repo_id: flags.get("repo-id"),
				filter_issue_type: flags.get("type"),
				filter_status: flags.get("status"),
			})
			if (!res.ok) fail(res)
			const rows = res.data as Record<string, unknown>[]
			return emit("# Aikido open issue groups\n\n" + table(rows, ["id", "severity", "type", "title", "group_status"]), rows)
		}
		case "group": {
			const res = await api(`/issues/groups/${positional[1]}`)
			if (!res.ok) fail(res)
			return emit("```json\n" + JSON.stringify(res.data, null, 2) + "\n```", res.data)
		}
		case "issue": {
			const res = await api(`/issues/${positional[1]}`)
			if (!res.ok) fail(res)
			return emit("```json\n" + JSON.stringify(res.data, null, 2) + "\n```", res.data)
		}
		case "get": {
			const [path, ...rest] = positional.slice(1)
			const query: Record<string, string> = {}
			for (const kv of rest) {
				const i = kv.indexOf("=")
				if (i > -1) query[kv.slice(0, i)] = kv.slice(i + 1)
			}
			const res = await api(path ?? "/", query)
			console.log(JSON.stringify({ status: res.status, data: res.data }, null, 2))
			if (!res.ok) process.exit(1)
			return
		}
		default:
			console.log(
				[
					"Usage: bun aikido.ts <command> [options]",
					"",
					"  pr <owner/repo#123|url|123>       Aikido checks on a PR (+ API detail)",
					"  scan <scanId> [--repo-id N]       PR check metadata",
					"  scans [--repo-id N] [--search S]  recent PR checks",
					"  repos [search]                    code repositories",
					"  issues --repo <name|id> [--severities critical,high] [--status open]",
					"  groups [--repo-id N]              open issue groups",
					"  group <id> | issue <id>           details",
					"  get <path> [k=v ...]              raw GET on /api/public/v1",
					"",
					"Flags: --json --limit N --page N --out FILE --no-api",
				].join("\n"),
			)
			process.exit(positional.length ? 1 : 0)
	}
}

main()
