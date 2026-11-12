#!/usr/bin/env bun
/** Aikido Security CLI helper for agents. */

import { execFileSync } from 'child_process'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'

type Creds = { clientId: string; clientSecret: string; apiUrl: string }
type ApiResult = { ok: boolean; status: number; data: unknown }
type CheckRun = { name: string; conclusion: string; details_url: string; output?: { summary?: string }; app?: { slug?: string } }
type ScanIssue = {
	title: string
	severity: number // Aikido priority score (1–100), not a severity label
	file?: string | null
	cve_id?: string | null
	package_name?: string | null
	installed_version?: string | null
	patched_versions?: string[] | null
	start_line?: number | null
	end_line?: number | null
	status?: string
}
type ScanDetail = {
	pull_request_url?: string
	end_commit_id?: string
	completed_scans?: string[]
	issues_added: ScanIssue[]
	issues_removed: ScanIssue[]
	[key: string]: unknown
}

const CRED_FILE = join(homedir(), '.config', 'aikido', 'credentials.json')
const CACHE_DIR = join(homedir(), '.cache', 'aikido')
const TOKEN_CACHE = join(CACHE_DIR, 'token.json')
// Public API is limited to 20 calls/minute.
let lastApiRequestAt = 0
const flags = new Map<string, string>()
const positional: string[] = []
for (let i = 0; i < process.argv.length - 2; i++) {
	const a = process.argv[i + 2]
	if (!a.startsWith('--')) positional.push(a)
	else if (a.includes('=')) {
		const [key, value] = a.slice(2).split(/=(.*)/s)
		flags.set(key, value)
	} else if (process.argv[i + 3] && !process.argv[i + 3].startsWith('--')) flags.set(a.slice(2), process.argv[++i + 2])
	else flags.set(a.slice(2), 'true')
}
const wantJson = flags.has('json')
const limit = Number(flags.get('limit') ?? 25)

function tryJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

async function loadCreds(soft = false): Promise<Creds | null> {
	const apiUrl = (process.env.AIKIDO_API_URL ?? 'https://app.aikido.dev').replace(/\/$/, '')
	if (process.env.AIKIDO_CLIENT_ID && process.env.AIKIDO_CLIENT_SECRET)
		return { clientId: process.env.AIKIDO_CLIENT_ID, clientSecret: process.env.AIKIDO_CLIENT_SECRET, apiUrl }
	const file = await readFile(CRED_FILE, 'utf-8').catch(() => null)
	if (file) {
		const parsed = JSON.parse(file)
		if (parsed.clientId && parsed.clientSecret)
			return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, apiUrl: parsed.apiUrl ?? apiUrl }
	}
	if (soft) return null
	console.error('❌ Aikido API credentials not found. Set AIKIDO_CLIENT_ID / AIKIDO_CLIENT_SECRET, or create ' + CRED_FILE)
	process.exit(2)
}

async function accessToken(creds: Creds): Promise<string> {
	const cached = await readFile(TOKEN_CACHE, 'utf-8').then(JSON.parse).catch(() => null)
	if (cached?.token && cached.apiUrl === creds.apiUrl && cached.expiresAt > Date.now() + 30_000) return cached.token
	const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
	const res = await fetch(`${creds.apiUrl}/api/oauth/token`, {
		method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials' }),
	})
	if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`)
	const data = await res.json() as { access_token: string; expires_in?: number }
	await mkdir(CACHE_DIR, { recursive: true })
	await writeFile(TOKEN_CACHE, JSON.stringify({ token: data.access_token, apiUrl: creds.apiUrl, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }), { mode: 0o600 })
	return data.access_token
}

async function api(path: string, query: Record<string, string | number | undefined> = {}): Promise<ApiResult> {
	if (flags.has('no-api')) throw new Error('This command requires the Aikido API; remove --no-api.')
	const creds = await loadCreds() as Creds
	const url = new URL(`${creds.apiUrl}/api/public/v1${path.startsWith('/') ? path : `/${path}`}`)
	for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
	for (let attempt = 0; attempt < 2; attempt++) {
		const wait = 3_100 - (Date.now() - lastApiRequestAt)
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
		lastApiRequestAt = Date.now()
		const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(creds)}`, Accept: 'application/json' } })
		const result = { ok: res.ok, status: res.status, data: tryJson(await res.text()) }
		if (res.status !== 429 || attempt === 1) return result
		await new Promise((resolve) => setTimeout(resolve, 65_000))
	}
	throw new Error('Unreachable')
}

function gh(args: string[]): unknown {
	const out = execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim()
	return out ? tryJson(out) : null
}

function parsePr(input: string) {
	const url = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
	if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) }
	const short = input.match(/^([^/]+)\/([^#]+)#(\d+)$/)
	if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) }
	if (/^#?\d+$/.test(input)) {
		const [owner, repo] = String(gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).split('/')
		return { owner, repo, number: Number(input.replace('#', '')) }
	}
	throw new Error(`Unrecognised PR reference: ${input}`)
}

function severityCounts(summary: string) {
	return [...summary.matchAll(/(\d+)\s+new\s+(CRITICAL|HIGH|MEDIUM|LOW)/gi)].reduce<Record<string, number>>((out, m) => {
		out[m[2].toLowerCase()] = Number(m[1]); return out
	}, {})
}

function table(rows: Record<string, unknown>[], columns: string[]) {
	if (!rows.length) return '_none_'
	return `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${columns.map((c) => String(row[c] ?? '').replace(/\n/g, ' ').slice(0, 140)).join(' | ')} |`).join('\n')}`
}

async function emit(markdown: string, data: unknown) {
	const body = wantJson ? JSON.stringify(data, null, 2) : markdown
	if (flags.get('out')) {
		await mkdir(dirname(flags.get('out')!), { recursive: true }); await writeFile(flags.get('out')!, body); console.log(`✅ Written to ${flags.get('out')}`)
	} else console.log(body)
}

function scanId(input: string): number {
	const id = /^\d+$/.test(input) ? Number(input) : Number(input.match(/^https:\/\/app(?:\.(?:us|me|au))?\.aikido\.dev\/featurebranch\/scan\/(\d+)(?:[/?#]|$)/)?.[1])
	if (!Number.isSafeInteger(id) || id < 1) throw new Error('Expected a positive scan ID or an Aikido feature-branch scan URL.')
	return id
}

async function scanDetail(id: number): Promise<ScanDetail> {
	const res = await api(`/report/ciScans/${id}/detail`)
	if (!res.ok) fail(res)
	const data = res.data as ScanDetail
	if (!data || !Array.isArray(data.issues_added) || !Array.isArray(data.issues_removed))
		throw new Error(`Scan ${id}: invalid detail response (expected issues_added and issues_removed arrays)`)
	return data
}

function renderScan(id: number, detail: ScanDetail): string {
	const rows = (issues: ScanIssue[]) => issues.map((issue) => ({
		priority: issue.severity, title: issue.title, identifier: issue.cve_id,
		package: issue.package_name, installed: issue.installed_version,
		fixed: issue.patched_versions?.join(', '),
		file: issue.file, lines: issue.start_line == null ? '' : `${issue.start_line}–${issue.end_line ?? issue.start_line}`,
		status: issue.status,
	}))
	const columns = ['priority', 'title', 'identifier', 'package', 'installed', 'fixed', 'file', 'lines', 'status']
	return [
		`## Scan ${id} — exact findings`, '',
		`- Source: GET /report/ciScans/${id}/detail`,
		`- Scanned commit: ${detail.end_commit_id ?? 'not reported'}`,
		`- Completed scans: ${detail.completed_scans?.join(', ') || 'not reported'}`,
		'- Priority is Aikido’s numeric 1–100 score, not a severity label. Added findings may include ignored/snoozed issues; totals need not equal gate counts.',
		'', `### Added (${detail.issues_added.length})`, '', table(rows(detail.issues_added), columns),
		'', `### Resolved (${detail.issues_removed.length})`, '', table(rows(detail.issues_removed), columns),
	].join('\n')
}

async function cmdPr(ref: string, requireFindings = false) {
	const { owner, repo, number } = parsePr(ref)
	const pr = gh(['pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'title,headRefName,headRefOid,url']) as { title: string; headRefName: string; headRefOid: string; url: string }
	const pages = gh(['api', `repos/${owner}/${repo}/commits/${pr.headRefOid}/check-runs?per_page=100`, '--paginate', '--slurp']) as { check_runs: CheckRun[] }[]
	const checks = pages.flatMap((page) => page.check_runs).filter((check) => check.app?.slug === 'aikido-security' || /aikido/i.test(check.name))
	const markdown = [`# Aikido — ${owner}/${repo}#${number}`, '', `- PR: ${pr.url} (\`${pr.headRefName}\`, commit \`${pr.headRefOid.slice(0, 10)}\`)`, `- Title: ${pr.title}`, '']
	for (const check of checks) {
		const summary = check.output?.summary ?? ''
		markdown.push(`## ${check.name} — ${check.conclusion}`, `- Scan: ${check.details_url}`, `- New: ${Object.entries(severityCounts(summary)).map(([s, n]) => `${n} ${s}`).join(', ') || 'not reported'}`, '')
	}
	if (!checks.length) markdown.push('_No Aikido check runs found on the head commit._')
	const scans: { scanId: number; detail: ScanDetail }[] = []
	const ids = [...new Set(checks.flatMap((check) => {
		try { return [scanId(check.details_url)] } catch { return [] }
	}))]
	if (requireFindings && !ids.length) throw new Error('No Aikido feature-branch scan URL found on the PR head commit. Use scan <id> with a known scan ID.')
	if (!flags.has('no-api') && await loadCreds(true)) {
		for (const id of ids) {
			const detail = await scanDetail(id)
			if (detail.end_commit_id && detail.end_commit_id !== pr.headRefOid)
				throw new Error(`Scan ${id} is for commit ${detail.end_commit_id}, not PR head ${pr.headRefOid}. Refusing stale findings.`)
			scans.push({ scanId: id, detail })
			markdown.push(renderScan(id, detail), '')
		}
	} else {
		if (requireFindings) throw new Error('Exact findings require Aikido credentials and API access (no --no-api).')
		markdown.push('> GitHub check data only; exact findings were not fetched. Configure Aikido credentials and run pr-findings, or use scan <id>.')
	}
	await emit(markdown.join('\n'), { pr, checks, scans })
}

function fail(res: ApiResult): never { throw new Error(`API ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}`) }

async function main() {
	const cmd = positional[0]
	switch (cmd) {
		case 'pr': return cmdPr(positional[1] ?? '')
		case 'pr-findings': return cmdPr(positional[1] ?? '', true)
		case 'scan': { const id = scanId(positional[1] ?? ''); const detail = await scanDetail(id); return emit(renderScan(id, detail), detail) }
		case 'scans': { const res = await api('/report/ciScans', { per_page: Math.min(limit, 50), page: Number(flags.get('page') ?? 0), filter_code_repo_id: flags.get('repo-id'), filter_gate_status: flags.get('gate-status'), search: flags.get('search') }); if (!res.ok) fail(res); return emit('# Aikido PR checks\n\n' + table(res.data as Record<string, unknown>[], ['scan_id', 'gate_status', 'new_issues_count', 'solved_issues_count', 'code_repo_name', 'branch_name', 'pull_request_url']), res.data) }
		case 'repos': { const res = await api('/repositories/code', { per_page: Math.min(limit, 100), filter_name: positional[1] }); if (!res.ok) fail(res); return emit('# Aikido code repositories\n\n' + table(res.data as Record<string, unknown>[], ['id', 'name', 'provider', 'active']), res.data) }
		case 'issues': { const repo = flags.get('repo'); const res = await api('/issues/export', { format: 'json', filter_status: flags.get('status') ?? 'open', filter_severities: flags.get('severities'), filter_issue_type: flags.get('type'), filter_code_repo_id: repo && /^\d+$/.test(repo) ? repo : undefined, filter_code_repo_name: repo && !/^\d+$/.test(repo) ? repo : undefined, per_page: Math.min(limit, 100), page: Number(flags.get('page') ?? 0) }); if (!res.ok) fail(res); return emit('# Aikido issues\n\n' + table(res.data as Record<string, unknown>[], ['id', 'severity', 'type', 'affected_package', 'affected_file', 'status']), res.data) }
		case 'groups': { const res = await api('/open-issue-groups', { per_page: Math.min(limit, 100), page: Number(flags.get('page') ?? 0), filter_code_repo_id: flags.get('repo-id'), filter_issue_type: flags.get('type'), filter_status: flags.get('status') }); if (!res.ok) fail(res); return emit('# Aikido open issue groups\n\n' + table(res.data as Record<string, unknown>[], ['id', 'severity', 'type', 'title', 'group_status']), res.data) }
		case 'group': case 'issue': { const res = await api(cmd === 'group' ? `/issues/groups/${positional[1]}` : `/issues/${positional[1]}`); if (!res.ok) fail(res); return emit(`\`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\``, res.data) }
		case 'get': { const [path, ...pairs] = positional.slice(1); const query = Object.fromEntries(pairs.filter((p) => p.includes('=')).map((p) => p.split(/=(.*)/s))); const res = await api(path ?? '/', query); if (!res.ok) fail(res); return emit(JSON.stringify(res.data, null, 2), res.data) }
		default:
			console.log('Usage: bun aikido.ts <pr|pr-findings|scan|scans|repos|issues|groups|group|issue|get> ...\n\nUse `pr-findings <PR>` or `scan <id|URL>` for exact added/resolved findings from the PR check detail API.')
	}
}

main().catch((error) => { console.error(`❌ ${error instanceof Error ? error.message : String(error)}`); process.exit(1) })
