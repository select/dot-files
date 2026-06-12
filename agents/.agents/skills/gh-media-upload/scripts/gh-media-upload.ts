#!/usr/bin/env bun
/**
 * Upload files (images/videos) to GitHub using the internal asset upload flow.
 * Reads the user_session cookie from Firefox snap's SQLite cookie DB.
 *
 * Usage:
 *   bun gh-image-upload.ts <file>... [--repo owner/repo] [--pr <number>] [-m <message>]
 *
 * Output: markdown reference per file, e.g.
 *   ![screenshot](https://github.com/user-attachments/assets/<uuid>)
 */

import { existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { basename, extname, resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { Database } from 'bun:sqlite';

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// ── Cookie extraction ───────────────────────────────────────────

function getFirefoxCookieDbPath(): string | null {
	const homeDir = process.env.HOME ?? '';
	const searchPaths = [
		// Snap Firefox (Ubuntu)
		join(homeDir, 'snap/firefox/common/.mozilla/firefox'),
		// Standard Firefox
		join(homeDir, '.mozilla/firefox'),
	];

	for (const profilesDir of searchPaths) {
		if (!existsSync(profilesDir)) continue;
		try {
			const entries = Array.from(
				new Bun.Glob('*/cookies.sqlite').scanSync({ cwd: profilesDir }),
			);
			if (entries.length > 0) {
				return join(profilesDir, entries[0]);
			}
		} catch {
			continue;
		}
	}
	return null;
}

function getGitHubSessionCookie(): string {
	// Check env var override first
	if (process.env.GH_IMAGE_SESSION) {
		return process.env.GH_IMAGE_SESSION;
	}

	const cookieDbPath = getFirefoxCookieDbPath();
	if (!cookieDbPath) {
		throw new Error(
			'No Firefox cookie database found. Set GH_IMAGE_SESSION env var with your GitHub user_session cookie value.',
		);
	}

	// Copy DB to temp to avoid locking issues with running Firefox
	const tempDb = join(tmpdir(), `ff_cookies_${Date.now()}.sqlite`);
	copyFileSync(cookieDbPath, tempDb);

	try {
		const database = new Database(tempDb, { readonly: true });
		const rows = database
			.query<
				{ value: string; expiry: number },
				[]
			>(`SELECT value, expiry FROM moz_cookies WHERE host LIKE '%github.com' AND name = 'user_session' ORDER BY expiry DESC LIMIT 1`)
			.all();
		database.close();

		if (rows.length === 0) {
			throw new Error(
				'No github.com user_session cookie found in Firefox. Are you logged into GitHub?',
			);
		}

		return rows[0].value;
	} finally {
		try {
			unlinkSync(tempDb);
		} catch {
			/* ignore */
		}
	}
}

// ── GitHub upload flow ──────────────────────────────────────────

function makeCookieHeader(sessionValue: string): string {
	return `user_session=${sessionValue}; __Host-user_session_same_site=${sessionValue}`;
}

interface IRepoInfo {
	owner: string;
	name: string;
	id: number;
}

async function resolveRepo(
	owner?: string,
	repoName?: string,
): Promise<IRepoInfo> {
	if (owner && repoName) {
		// Get repo ID via gh API
		const json = execSync(
			`gh api repos/${owner}/${repoName} --jq '.id'`,
		).toString().trim();
		return { owner, name: repoName, id: parseInt(json, 10) };
	}

	// Infer from git remote
	const remote = execSync('git remote get-url origin').toString().trim();
	const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
	if (!match) {
		throw new Error(
			`Could not infer GitHub repo from remote: ${remote}. Use --repo owner/repo`,
		);
	}
	const inferredOwner = match[1];
	const inferredName = match[2];
	const json = execSync(
		`gh api repos/${inferredOwner}/${inferredName} --jq '.id'`,
	).toString().trim();
	return { owner: inferredOwner, name: inferredName, id: parseInt(json, 10) };
}

async function getUploadToken(
	cookie: string,
	owner: string,
	repo: string,
): Promise<string> {
	const response = await fetch(`https://github.com/${owner}/${repo}`, {
		headers: {
			'User-Agent': USER_AGENT,
			Cookie: makeCookieHeader(cookie),
		},
	});

	if (!response.ok) {
		throw new Error(
			`Repo page returned ${response.status} — do you have access to ${owner}/${repo}?`,
		);
	}

	const body = await response.text();

	// Detect expired/invalid session: GitHub returns a sign-in page
	if (body.includes('action="/session"') || (body.includes('<a href="/login"') && !body.match(/"uploadToken":/))) {
		throw new Error(
			'GitHub session expired. Please log into GitHub in Firefox and try again.',
		);
	}

	const match = body.match(/"uploadToken":"([^"]+)"/);
	if (!match) {
		throw new Error(
			`uploadToken not found on repo page — do you have write access to ${owner}/${repo}?`,
		);
	}
	return match[1];
}

interface IPolicyResponse {
	upload_url: string;
	asset: { id: number; name: string; size: number; content_type: string; href: string };
	form: Record<string, string>;
	asset_upload_authenticity_token: string;
}

async function requestPolicy(
	cookie: string,
	owner: string,
	repo: string,
	uploadToken: string,
	repoId: number,
	fileName: string,
	fileSize: number,
	contentType: string,
): Promise<IPolicyResponse> {
	const formData = new FormData();
	formData.append('name', fileName);
	formData.append('size', String(fileSize));
	formData.append('content_type', contentType);
	formData.append('authenticity_token', uploadToken);
	formData.append('repository_id', String(repoId));

	const response = await fetch(
		'https://github.com/upload/policies/assets',
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Origin: 'https://github.com',
				Referer: `https://github.com/${owner}/${repo}`,
				'X-Requested-With': 'XMLHttpRequest',
				'User-Agent': USER_AGENT,
				Cookie: makeCookieHeader(cookie),
			},
			body: formData,
		},
	);

	if (response.status !== 201) {
		const text = await response.text();
		throw new Error(
			`Policy request: expected 201, got ${response.status}: ${text.slice(0, 200)}`,
		);
	}

	return (await response.json()) as IPolicyResponse;
}

async function uploadToS3(
	policy: IPolicyResponse,
	filePath: string,
	fileName: string,
	contentType: string,
): Promise<void> {
	const formData = new FormData();

	// Write S3 form fields in deterministic order
	const fieldOrder = [
		'key',
		'acl',
		'policy',
		'X-Amz-Algorithm',
		'X-Amz-Credential',
		'X-Amz-Date',
		'X-Amz-Signature',
		'Content-Type',
		'Cache-Control',
		'x-amz-meta-Surrogate-Control',
	];

	const written = new Set<string>();
	for (const key of fieldOrder) {
		if (key in policy.form) {
			formData.append(key, policy.form[key]);
			written.add(key);
		}
	}
	// Any remaining fields
	for (const [key, value] of Object.entries(policy.form)) {
		if (!written.has(key)) {
			formData.append(key, value);
		}
	}

	// File must be the last field
	const fileData = Bun.file(filePath);
	formData.append('file', fileData, fileName);

	const response = await fetch(policy.upload_url, {
		method: 'POST',
		headers: {
			Origin: 'https://github.com',
			'User-Agent': USER_AGENT,
		},
		body: formData,
	});

	if (
		response.status !== 204 &&
		response.status !== 200 &&
		response.status !== 201
	) {
		const text = await response.text();
		throw new Error(`S3 returned ${response.status}: ${text.slice(0, 300)}`);
	}
}

async function finalizeUpload(
	cookie: string,
	owner: string,
	repo: string,
	policy: IPolicyResponse,
): Promise<{ href: string; name: string }> {
	const formData = new FormData();
	formData.append(
		'authenticity_token',
		policy.asset_upload_authenticity_token,
	);

	const response = await fetch(
		`https://github.com/upload/assets/${policy.asset.id}`,
		{
			method: 'PUT',
			headers: {
				Accept: 'application/json',
				Origin: 'https://github.com',
				Referer: `https://github.com/${owner}/${repo}`,
				'X-Requested-With': 'XMLHttpRequest',
				'User-Agent': USER_AGENT,
				Cookie: makeCookieHeader(cookie),
			},
			body: formData,
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Finalize: expected 200, got ${response.status}: ${text.slice(0, 200)}`,
		);
	}

	return (await response.json()) as { href: string; name: string };
}

function getMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	const mimeMap: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.svg': 'image/svg+xml',
		'.bmp': 'image/bmp',
		'.ico': 'image/x-icon',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mov': 'video/quicktime',
		'.avi': 'video/x-msvideo',
		'.mkv': 'video/x-matroska',
		'.ogg': 'video/ogg',
	};
	return mimeMap[ext] ?? 'application/octet-stream';
}

const VIDEO_EXTENSIONS = new Set([
	'.mp4',
	'.webm',
	'.mov',
	'.avi',
	'.mkv',
	'.ogg',
]);

function toMarkdown(fileName: string, url: string): string {
	const ext = extname(fileName).toLowerCase();
	if (VIDEO_EXTENSIONS.has(ext)) {
		return `<video src="${url}" controls title="${fileName}"></video>`;
	}
	const name = fileName.replace(/\.[^.]+$/, '');
	return `![${name}](${url})`;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs({
		allowPositionals: true,
		options: {
			repo: { type: 'string' },
			pr: { type: 'string' },
			issue: { type: 'string' },
			message: { type: 'string', short: 'm' },
			raw: { type: 'boolean', short: 'r', default: false },
			json: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false },
		},
	});

	if (args.values.help) {
		console.log(`Usage: bun gh-image-upload.ts <file>... [--repo owner/repo] [--pr N] [-m message]

Upload files to GitHub using the internal asset upload flow.
Reads user_session cookie from Firefox (snap or standard) automatically.

Options:
  --repo owner/repo   Target repository (auto-detected from git remote)
  --pr N              Comment on PR with uploaded files
  --issue N           Comment on issue with uploaded files
  -m, --message TEXT  Caption/message to include
  -r, --raw           Print raw URLs only
  --json              Print JSON output
  -h, --help          Show this help

Environment:
  GH_IMAGE_SESSION    Override: provide user_session cookie value directly`);
		process.exit(0);
	}

	const files = args.positionals;
	if (files.length === 0) {
		console.error('Error: no files provided');
		process.exit(1);
	}

	// Validate files
	const cwd = resolve('.');
	const homeDir = resolve(process.env.HOME ?? '/');
	const resolvedFiles = files.map((filePath) => {
		const resolved = resolve(filePath);
		// Only allow files under cwd or home directory
		if (!resolved.startsWith(cwd) && !resolved.startsWith(homeDir)) {
			console.error(
				`Error: file path must be under cwd or home directory: ${filePath}`,
			);
			process.exit(1);
		}
		if (!existsSync(resolved)) {
			console.error(`Error: file not found: ${filePath}`);
			process.exit(1);
		}
		return resolved;
	});

	// Get cookie
	let sessionCookie: string;
	try {
		sessionCookie = getGitHubSessionCookie();
	} catch (error) {
		console.error(
			`Error: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	}

	// Resolve repo
	let owner: string | undefined;
	let repoName: string | undefined;
	if (args.values.repo) {
		const parts = args.values.repo.split('/');
		if (parts.length !== 2) {
			console.error('Error: --repo must be in owner/repo format');
			process.exit(1);
		}
		owner = parts[0];
		repoName = parts[1];
	}

	let repoInfo: IRepoInfo;
	try {
		repoInfo = await resolveRepo(owner, repoName);
	} catch (error) {
		console.error(
			`Error resolving repo: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	}

	// Get upload token
	let uploadToken: string;
	try {
		uploadToken = await getUploadToken(
			sessionCookie,
			repoInfo.owner,
			repoInfo.name,
		);
	} catch (error) {
		console.error(
			`Error: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	}

	// Upload each file
	const results: Array<{ fileName: string; url: string; markdown: string }> = [];
	let hasError = false;

	for (const filePath of resolvedFiles) {
		const fileName = basename(filePath);
		const fileSize = Bun.file(filePath).size;
		const contentType = getMimeType(filePath);

		try {
			process.stderr.write(`Uploading ${fileName}...\n`);

			const policy = await requestPolicy(
				sessionCookie,
				repoInfo.owner,
				repoInfo.name,
				uploadToken,
				repoInfo.id,
				fileName,
				fileSize,
				contentType,
			);

			await uploadToS3(policy, filePath, fileName, contentType);

			const result = await finalizeUpload(
				sessionCookie,
				repoInfo.owner,
				repoInfo.name,
				policy,
			);

			const markdown = toMarkdown(fileName, result.href);
			results.push({ fileName, url: result.href, markdown });
			process.stderr.write(`✓ Uploaded ${fileName}\n`);
		} catch (error) {
			console.error(
				`Error uploading ${fileName}: ${error instanceof Error ? error.message : error}`,
			);
			hasError = true;
		}
	}

	if (results.length === 0) {
		process.exit(1);
	}

	// Post-upload actions
	const prNumber = args.values.pr;
	const issueNumber = args.values.issue;
	const message = args.values.message;

	if (prNumber || issueNumber) {
		const markdownBlock = results.map((result) => result.markdown).join('\n');
		const body = message ? `${message}\n\n${markdownBlock}` : markdownBlock;
		const targetType = prNumber ? 'pr' : 'issue';
		const targetNumber = prNumber ?? issueNumber;

		try {
			const repoArg = `--repo ${repoInfo.owner}/${repoInfo.name}`;
			execSync(
				`gh ${targetType} comment ${targetNumber} ${repoArg} --body ${JSON.stringify(body)}`,
				{ stdio: ['pipe', 'pipe', 'pipe'] },
			);
			process.stderr.write(
				`✓ Commented on ${targetType} #${targetNumber}\n`,
			);
		} catch (error) {
			console.error(
				`Error commenting on ${targetType} #${targetNumber}: ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	// Print results
	for (const result of results) {
		if (args.values.json) {
			console.log(JSON.stringify(result));
		} else if (args.values.raw) {
			console.log(result.url);
		} else {
			console.log(result.markdown);
		}
	}

	if (hasError) process.exit(1);
}

main().catch((error) => {
	console.error(`Fatal: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
