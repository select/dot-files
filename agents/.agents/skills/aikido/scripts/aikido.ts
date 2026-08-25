#!/usr/bin/env bun
/** Aikido Security CLI helper for agents. */

import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'

type Creds = { clientId: string; clientSecret: string; apiUrl: string }
type ApiResult = { ok: boolean; status: number; data: unknown }
type CheckRun = { name: string; conclusion: string; details_url: string; output?: { summary?: string }; app?: { slug?: string } }
type Issue = {
	id: number
	severity: string
	type?: string
	status?: string
	affected_package?: string
	affected_file?: string
	first_detected_at?: number
	cve_id?: string | null
	issue_type_metadata?: { open_source?: { installed_version?: string; patched_versions?: string[] } }
}

const CRED_FILE = join(homedir(), '.config', 'aikido', 'credentials.json')
const CACHE_DIR = join(homedir(), '.cache', 'aikido')
const TOKEN_CACHE = join(CACHE_DIR, 'token.json')
const ISSUE_CACHE_DIR = join(CACHE_DIR, 'issues')
// Public API is limited to 20 calls/minute. Keep automated correlation below that rate.
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

function ghFile(owner: string, repo: string, path: string, ref: string): string {
	const content = String(gh(['api', `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, '--jq', '.content'])).replace(/\n/g, '')
	return Buffer.from(content, 'base64').toString('utf-8')
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

function lockPackages(lock: string): Map<string, Set<string>> {
	// pnpm v9 lockfiles quote package snapshots as: 'name@version':
	const packages = new Map<string, Set<string>>()
	const start = lock.indexOf('\npackages:')
	if (start === -1) return packages
	for (const match of lock.slice(start).matchAll(/^  (?:(?:['"](.+?)['"])|([^:\s]+)):\s*$/gm)) {
		const key = (match[1] ?? match[2]).replace(/\([^)]*\).*$/, '')
		const at = key.lastIndexOf('@')
		if (at <= 0) continue
		const name = key.slice(0, at)
		const version = key.slice(at + 1)
		if (/^\d+\.\d+\.\d+/.test(version)) (packages.get(name) ?? packages.set(name, new Set()).get(name)!).add(version)
	}
	return packages
}

function addedPackages(base: string, head: string) {
	const before = lockPackages(base), after = lockPackages(head)
	const added = new Map<string, Set<string>>()
	for (const [name, versions] of after) {
		const prior = before.get(name) ?? new Set<string>()
		const newVersions = new Set([...versions].filter((version) => !prior.has(version)))
		if (newVersions.size) added.set(name, newVersions)
	}
	return added
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

async function findScan(scanId: number, repoId?: number) {
	for (let page = 0; page < 20; page++) {
		const res = await api('/report/ciScans', { page, per_page: 50, filter_code_repo_id: repoId })
		if (!res.ok) return { error: res, scan: null }
		const scans = res.data as { scan_id: number }[]
		const hit = scans.find((scan) => Number(scan.scan_id) === scanId)
		if (hit || !scans.length) return { error: null, scan: hit ?? null }
	}
	return { error: null, scan: null }
}

async function exportedIssues(repoId: number, status: string, severities: string) {
	const all: Issue[] = []
	for (let page = 0; page < 20; page++) {
		const res = await api('/issues/export', { format: 'json', filter_status: status, filter_severities: severities, filter_code_repo_id: repoId, per_page: 100, page })
		if (!res.ok) throw new Error(`Issue export (${status}) failed: ${res.status}`)
		const items = res.data as Issue[]
		all.push(...items)
		if (items.length < 100) break
	}
	return all
}

async function issueDetail(id: number): Promise<Issue> {
	const file = join(ISSUE_CACHE_DIR, `${id}.json`)
	const cached = await readFile(file, 'utf-8').then((raw) => ({ value: JSON.parse(raw) as Issue, age: Date.now() - JSON.parse(raw).cachedAt })).catch(() => null)
	if (cached && cached.age < 24 * 60 * 60 * 1000) return cached.value
	let res = await api(`/issues/${id}`)
	if (res.status === 429) { await new Promise((resolve) => setTimeout(resolve, 65_000)); res = await api(`/issues/${id}`) }
	if (!res.ok) throw new Error(`Issue ${id} failed: ${res.status}`)
	await mkdir(ISSUE_CACHE_DIR, { recursive: true })
	await writeFile(file, JSON.stringify({ ...(res.data as object), cachedAt: Date.now() }))
	return res.data as Issue
}

function detailMatchesAdded(issue: Issue, added: Map<string, Set<string>>) {
	const versions = issue.issue_type_metadata?.open_source?.installed_version
	return !!issue.affected_package && added.has(issue.affected_package) && (!versions || added.get(issue.affected_package)!.has(versions))
}

async function auditCrossCheck(packageJson: string, lock: string, directAdded: string[]) {
	const dir = await mkdtemp(join(tmpdir(), 'aikido-audit-'))
	try {
		await writeFile(join(dir, 'package.json'), packageJson); await writeFile(join(dir, 'pnpm-lock.yaml'), lock)
		let raw = ''
		try {
			raw = execFileSync('pnpm', ['audit', '--json', '--lockfile-only', '--registry=https://registry.npmjs.org'], { cwd: dir, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
		} catch (error) {
			// pnpm exits 1 when vulnerabilities are found; stdout still contains its JSON report.
			raw = String((error as { stdout?: string }).stdout ?? '')
		}
		if (!raw) throw new Error('pnpm audit returned no JSON output')
		return Object.values((JSON.parse(raw) as { advisories?: Record<string, { severity: string; module_name: string; github_advisory_id?: string; title: string; patched_versions?: string; findings: { paths: string[] }[] }> }).advisories ?? {})
			.filter((advisory) => advisory.findings.some((finding) => finding.paths.some((path) => directAdded.some((name) => path.includes(name)))))
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) }
	} finally { await rm(dir, { recursive: true, force: true }) }
}

async function cmdPr(ref: string) {
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
	markdown.push('> The public API exposes per-scan counts only. Run `pr-findings` to correlate those counts with dependency changes and open/closed repository issues.')
	await emit(markdown.join('\n'), { pr, checks })
}

async function cmdPrFindings(ref: string) {
	const { owner, repo, number } = parsePr(ref)
	const pr = gh(['pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'title,url,baseRefOid,headRefOid']) as { title: string; url: string; baseRefOid: string; headRefOid: string }
	const pages = gh(['api', `repos/${owner}/${repo}/commits/${pr.headRefOid}/check-runs?per_page=100`, '--paginate', '--slurp']) as { check_runs: CheckRun[] }[]
	const checks = pages.flatMap((page) => page.check_runs).filter((check) => check.app?.slug === 'aikido-security' || /aikido/i.test(check.name))
	const expected = checks.reduce<Record<string, number>>((all, check) => {
		for (const [severity, count] of Object.entries(severityCounts(check.output?.summary ?? ''))) all[severity] = (all[severity] ?? 0) + count
		return all
	}, {})
	const baseLock = ghFile(owner, repo, 'pnpm-lock.yaml', pr.baseRefOid)
	const headLock = ghFile(owner, repo, 'pnpm-lock.yaml', pr.headRefOid)
	const basePackageJson = ghFile(owner, repo, 'package.json', pr.baseRefOid)
	const headPackageJson = ghFile(owner, repo, 'package.json', pr.headRefOid)
	const added = addedPackages(baseLock, headLock)
	const baseManifest = JSON.parse(basePackageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
	const headManifest = JSON.parse(headPackageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
	const baseDirect = { ...baseManifest.dependencies, ...baseManifest.devDependencies }
	const directAdded = Object.keys({ ...headManifest.dependencies, ...headManifest.devDependencies }).filter((name) => !(name in baseDirect))
	const repos = await api('/repositories/code', { per_page: 100, filter_name: repo })
	if (!repos.ok) throw new Error(`Repository lookup failed: ${repos.status}`)
	const codeRepo = (repos.data as { id: number; name: string }[]).find((r) => r.name.toLowerCase() === repo.toLowerCase())
	if (!codeRepo) throw new Error(`No Aikido code repository matched ${repo}`)
	const scanId = checks.map((check) => Number(check.details_url?.match(/\/featurebranch\/scan\/(\d+)/)?.[1])).find(Number.isFinite)
	const scanResult = scanId ? await findScan(scanId, codeRepo.id) : { scan: null }
	const scanStartedAt = Number((scanResult.scan as { started_at?: number } | null)?.started_at ?? Number.MAX_SAFE_INTEGER)
	const severities = Object.keys(expected).join(',') || 'critical,high,medium,low'
	const exports = [...await exportedIssues(codeRepo.id, 'open', severities), ...await exportedIssues(codeRepo.id, 'closed', severities)]
	const candidateSummaries = exports.filter((issue) => issue.type === 'open_source' && !!issue.affected_package && added.has(issue.affected_package))
	const candidates: Issue[] = []
	for (const candidate of candidateSummaries) {
		const detail = await issueDetail(candidate.id)
		if (detailMatchesAdded(detail, added) && (!detail.first_detected_at || detail.first_detected_at <= scanStartedAt)) candidates.push(detail)
	}
	// The public API has no scan-to-issue relation. Prefer the most recently detected candidate per
	// severity, then require the resulting totals to equal the scan totals.
	const findings = Object.entries(expected).flatMap(([severity, count]) => candidates
		.filter((candidate) => candidate.severity === severity)
		.sort((a, b) => (b.first_detected_at ?? 0) - (a.first_detected_at ?? 0))
		.slice(0, count))
	const actual = findings.reduce<Record<string, number>>((counts, finding) => { counts[finding.severity] = (counts[finding.severity] ?? 0) + 1; return counts }, {})
	const matchesCounts = Object.entries(expected).every(([severity, count]) => actual[severity] === count)
	const audit = await auditCrossCheck(headPackageJson, headLock, directAdded)
	const rows = findings.map((finding) => ({
		severity: finding.severity, identifier: finding.cve_id ?? 'No CVE/GHSA returned', package: finding.affected_package,
		installed: finding.issue_type_metadata?.open_source?.installed_version, fixed: finding.issue_type_metadata?.open_source?.patched_versions?.join(', '),
		status: finding.status, reachability: (finding as Issue & { reachability_status?: string }).reachability_status,
	}))
	const lines = [`# Aikido correlated findings — ${owner}/${repo}#${number}`, '', `- PR: ${pr.url}`, `- Title: ${pr.title}`, `- Scan expected: ${Object.entries(expected).map(([s, n]) => `${n} ${s}`).join(', ') || 'no new-issue count reported'}`, `- Direct dependencies added: ${directAdded.join(', ') || 'none detected'}`, `- Dependency versions added: ${[...added].map(([name, versions]) => `${name}@${[...versions].join(',')}`).join('; ') || 'none detected'}`, `- Candidate selection: most recently detected matching issue per severity before the scan${scanId ? ` (scan ${scanId})` : ''}`, '']
	lines.push(matchesCounts ? '> **High confidence correlation:** the affected package/version and severity totals match the Aikido scan.' : '> **Candidate correlation only:** the public API does not expose issue IDs per scan and the candidate totals do not exactly match.')
	lines.push('', '## Aikido findings', '', table(rows, ['severity', 'identifier', 'package', 'installed', 'fixed', 'status', 'reachability']), '', '## npm audit cross-check', '')
	if (Array.isArray(audit)) lines.push(table(audit.map((a) => ({ severity: a.severity, package: a.module_name, advisory: a.github_advisory_id, title: a.title, fixed: a.patched_versions })), ['severity', 'package', 'advisory', 'title', 'fixed']))
	else lines.push(`_Unavailable: ${audit.error}_`)
	lines.push('', '> npm audit is a secondary advisory source; Aikido findings above are the authoritative correlated records.')
	await emit(lines.join('\n'), { pr, scanId, scanStartedAt, expected, directAdded, added: Object.fromEntries([...added].map(([name, versions]) => [name, [...versions]])), findings, candidates, matchesCounts, audit })
}

function fail(res: ApiResult): never { throw new Error(`API ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}`) }

async function main() {
	const cmd = positional[0]
	switch (cmd) {
		case 'pr': return cmdPr(positional[1] ?? '')
		case 'pr-findings': return cmdPrFindings(positional[1] ?? '')
		case 'scan': { const found = await findScan(Number(positional[1]), flags.get('repo-id') ? Number(flags.get('repo-id')) : undefined); if (found.error) fail(found.error); return emit(`# Aikido PR check ${positional[1]}\n\n\`\`\`json\n${JSON.stringify(found.scan, null, 2)}\n\`\`\``, found.scan) }
		case 'scans': { const res = await api('/report/ciScans', { per_page: Math.min(limit, 50), page: Number(flags.get('page') ?? 0), filter_code_repo_id: flags.get('repo-id'), filter_gate_status: flags.get('gate-status'), search: flags.get('search') }); if (!res.ok) fail(res); return emit('# Aikido PR checks\n\n' + table(res.data as Record<string, unknown>[], ['scan_id', 'gate_status', 'new_issues_count', 'solved_issues_count', 'code_repo_name', 'branch_name', 'pull_request_url']), res.data) }
		case 'repos': { const res = await api('/repositories/code', { per_page: Math.min(limit, 100), filter_name: positional[1] }); if (!res.ok) fail(res); return emit('# Aikido code repositories\n\n' + table(res.data as Record<string, unknown>[], ['id', 'name', 'provider', 'active']), res.data) }
		case 'issues': { const repo = flags.get('repo'); const res = await api('/issues/export', { format: 'json', filter_status: flags.get('status') ?? 'open', filter_severities: flags.get('severities'), filter_issue_type: flags.get('type'), filter_code_repo_id: repo && /^\d+$/.test(repo) ? repo : undefined, filter_code_repo_name: repo && !/^\d+$/.test(repo) ? repo : undefined, per_page: Math.min(limit, 100), page: Number(flags.get('page') ?? 0) }); if (!res.ok) fail(res); return emit('# Aikido issues\n\n' + table(res.data as Record<string, unknown>[], ['id', 'severity', 'type', 'affected_package', 'affected_file', 'status']), res.data) }
		case 'groups': { const res = await api('/open-issue-groups', { per_page: Math.min(limit, 100), page: Number(flags.get('page') ?? 0), filter_code_repo_id: flags.get('repo-id'), filter_issue_type: flags.get('type'), filter_status: flags.get('status') }); if (!res.ok) fail(res); return emit('# Aikido open issue groups\n\n' + table(res.data as Record<string, unknown>[], ['id', 'severity', 'type', 'title', 'group_status']), res.data) }
		case 'group': case 'issue': { const res = await api(cmd === 'group' ? `/issues/groups/${positional[1]}` : `/issues/${positional[1]}`); if (!res.ok) fail(res); return emit(`\`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\``, res.data) }
		case 'get': { const [path, ...pairs] = positional.slice(1); const query = Object.fromEntries(pairs.filter((p) => p.includes('=')).map((p) => p.split(/=(.*)/s))); const res = await api(path ?? '/', query); if (!res.ok) fail(res); return emit(JSON.stringify(res.data, null, 2), res.data) }
		default:
			console.log('Usage: bun aikido.ts <pr|pr-findings|scan|scans|repos|issues|groups|group|issue|get> ...\n\nUse `pr-findings <PR>` to correlate a failed feature-branch scan with dependency changes, open/closed Aikido issues, and npm audit.')
	}
}

main().catch((error) => { console.error(`❌ ${error instanceof Error ? error.message : String(error)}`); process.exit(1) })
