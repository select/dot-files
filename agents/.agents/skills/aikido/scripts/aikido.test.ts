import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const detail = {
	end_commit_id: 'head123', completed_scans: ['dependency_scan', 'sast_scan'],
	issues_added: [
		{ title: 'Pillow vulnerability', severity: 90, file: 'uv.lock', cve_id: 'CVE-TEST', package_name: 'pillow', installed_version: '1.0', patched_versions: ['2.0'], status: 'open' },
		{ title: 'Docker issue', severity: 20, file: 'Dockerfile', cve_id: null, package_name: null, patched_versions: null, start_line: 2, end_line: 4, status: 'ignored' },
	],
	issues_removed: [{ id: 101, grouped_issue_id: 55, title: 'Resolved issue', severity: 80, file: 'src/code.py', package_name: null }],
}
const check = { name: 'Aikido Security', conclusion: 'failure', details_url: 'https://app.aikido.dev/featurebranch/scan/123?groupId=3022', output: { summary: '1 new HIGH' } }

function run(args: string[], options: { status?: number; data?: unknown; checks?: unknown[]; credentials?: boolean; fileCredentials?: boolean; out?: boolean } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'aikido-test-'))
	dirs.push(dir)
	mkdirSync(join(dir, 'bin'))
	// Never inherit controller credentials, HOME, token caches, or the real gh executable.
	writeFileSync(join(dir, 'bin', 'gh'), '#!/bin/sh\nif [ "$1" = pr ]; then printf "%s" "$MOCK_PR"; else printf "%s" "$MOCK_CHECKS"; fi\n', { mode: 0o755 })
	writeFileSync(join(dir, 'preload.ts'), `
import { appendFileSync } from 'fs'
let clock = Date.now()
Date.now = () => clock += 5000
globalThis.fetch = async (input) => {
 const url = new URL(String(input))
 appendFileSync(process.env.MOCK_LOG!, url.pathname + '\\n')
 if (url.pathname === '/api/oauth/token') return Response.json({ access_token: 'synthetic-token', expires_in: 3600 })
 if (url.pathname !== '/api/public/v1/report/ciScans/123/detail') throw new Error('Unexpected request: ' + url.pathname)
 return Response.json(JSON.parse(process.env.MOCK_DATA!), { status: Number(process.env.MOCK_STATUS) })
}
`)
	if (options.fileCredentials) {
		mkdirSync(join(dir, '.config', 'aikido'), { recursive: true })
		writeFileSync(join(dir, '.config', 'aikido', 'credentials.json'), JSON.stringify({ clientId: 'synthetic-id', clientSecret: 'synthetic-secret' }))
	}
	const log = join(dir, 'requests')
	const out = join(dir, 'result.json')
	const result = spawnSync(process.execPath, ['--preload', join(dir, 'preload.ts'), join(import.meta.dir, 'aikido.ts'), ...args, ...(options.out ? ['--out', out] : [])], {
		encoding: 'utf8', env: {
			HOME: dir, PATH: join(dir, 'bin'),
			...(options.credentials === false || options.fileCredentials ? {} : { AIKIDO_CLIENT_ID: 'synthetic-id', AIKIDO_CLIENT_SECRET: 'synthetic-secret' }),
			MOCK_LOG: log, MOCK_STATUS: String(options.status ?? 200), MOCK_DATA: JSON.stringify(options.data ?? detail),
			MOCK_PR: JSON.stringify({ title: 'Example PR', headRefName: 'feat/example', headRefOid: 'head123', url: 'https://github.com/example/repo/pull/5' }),
			MOCK_CHECKS: JSON.stringify([{ check_runs: options.checks ?? [check] }]),
		},
	})
	return { ...result, requests: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [], saved: existsSync(out) ? readFileSync(out, 'utf8') : null }
}

test('scan fetches exact details directly, preserving Python, non-package, nullable, and removed findings', () => {
	const r = run(['scan', '123', '--json'])
	expect(r.status).toBe(0)
	expect(JSON.parse(r.stdout)).toEqual(detail)
	expect(r.requests).toEqual(['/api/oauth/token', '/api/public/v1/report/ciScans/123/detail'])
})

test('scan URL and file credentials work; Markdown shows priority, status, fixes and resolved issues', () => {
	const r = run(['scan', 'https://app.us.aikido.dev/featurebranch/scan/123?groupId=3022'], { fileCredentials: true })
	expect(r.status).toBe(0)
	for (const value of ['exact findings', 'priority', '90', 'uv.lock', '2.0', 'Dockerfile', 'ignored', '2–4', 'Resolved (1)']) expect(r.stdout).toContain(value)
	expect(r.stdout).not.toContain('High confidence correlation')
})

test('pr-findings works without pnpm/lockfiles and deduplicates scan URLs', () => {
	const r = run(['pr-findings', 'example/repo#5', '--json'], { checks: [check, check] })
	expect(r.status).toBe(0)
	expect(JSON.parse(r.stdout).scans).toEqual([{ scanId: 123, detail }])
	expect(r.requests).toHaveLength(2)
})

test('pr automatically fetches details when credentials are available', () => {
	const r = run(['pr', 'https://github.com/example/repo/pull/5', '--json'])
	expect(r.status).toBe(0)
	expect(JSON.parse(r.stdout).scans[0].detail).toEqual(detail)
})

for (const args of [['pr', 'example/repo#5', '--no-api'], ['pr', 'example/repo#5']]) {
	test(`GitHub-only mode is explicit: ${args.join(' ')}`, () => {
		const r = run(args, { credentials: args.includes('--no-api') })
		expect(r.status).toBe(0)
		expect(r.stdout).toContain('exact findings were not fetched')
		expect(r.requests).toEqual([])
	})
}

for (const options of [{ credentials: false }, { checks: [] }, { checks: [{ ...check, details_url: 'https://example.com/other' }] }]) {
	test(`pr-findings refuses missing credentials or scan URLs: ${JSON.stringify(options)}`, () => {
		const r = run(['pr-findings', 'example/repo#5'], options)
		expect(r.status).not.toBe(0)
		expect(r.requests).toEqual([])
	})
}

test('pr rejects scan details for a different commit', () => {
	const r = run(['pr-findings', 'example/repo#5'], { data: { ...detail, end_commit_id: 'stale' } })
	expect(r.status).not.toBe(0)
	expect(r.stderr).toContain('Refusing stale findings')
})

for (const status of [403, 404, 500]) {
	test(`API ${status} fails visibly instead of returning empty/correlated findings`, () => {
		const r = run(['scan', '123'], { status, data: { error: 'unavailable' } })
		expect(r.status).not.toBe(0)
		expect(r.stderr).toContain(`API ${status}`)
		expect(r.stdout).toBe('')
	})
}

test('empty exact scan succeeds; malformed detail fails', () => {
	const empty = { ...detail, issues_added: [], issues_removed: [] }
	expect(JSON.parse(run(['scan', '123', '--json'], { data: empty }).stdout)).toEqual(empty)
	expect(run(['scan', '123'], { data: {} }).stderr).toContain('invalid detail response')
})

for (const id of ['0', '-1', 'NaN', 'https://evil.example/featurebranch/scan/123']) {
	test(`invalid scan ID rejected before any API call: ${id}`, () => {
		const r = run(['scan', id])
		expect(r.status).not.toBe(0)
		expect(r.requests).toEqual([])
	})
}

test('API-dependent commands reject --no-api', () => {
	const r = run(['scan', '123', '--no-api'])
	expect(r.status).not.toBe(0)
	expect(r.requests).toEqual([])
})

test('--out JSON retains full exact detail', () => {
	const r = run(['scan', '123', '--json'], { out: true })
	expect(r.status).toBe(0)
	expect(JSON.parse(r.saved!)).toEqual(detail)
	expect(r.stdout).not.toContain('CVE-TEST')
})
