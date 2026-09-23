#!/usr/bin/env node
/**
 * Fetch all open PRs authored by the current GitHub user and output as markdown grouped by repo.
 * Usage: node fetch-my-open-prs.js [--output <file>]
 *
 * Requires: gh CLI installed and authenticated
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { parseArgs } from 'util';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		output: { type: 'string', short: 'o' },
	},
});

function ghRaw(args) {
	return execSync(`gh ${args}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function gh(args) {
	return JSON.parse(ghRaw(args));
}

// Get current user
const username = ghRaw('api user --jq .login').trim().replace(/"/g, '');

// Search for all open PRs authored by the user
const prs = gh(
	`api "search/issues?q=is:pr+is:open+author:${username}&per_page=100" --jq '.items'`,
);

if (prs.length === 0) {
	const msg = `# Open PRs for @${username}\n\nNo open pull requests found.\n`;
	process.stdout.write(msg);
	if (values.output) writeFileSync(values.output, msg);
	process.exit(0);
}

// Group by repo
const byRepo = {};
for (const pr of prs) {
	// repository_url: https://api.github.com/repos/owner/repo
	const repo = pr.repository_url.replace('https://api.github.com/repos/', '');
	if (!byRepo[repo]) byRepo[repo] = [];
	byRepo[repo].push(pr);
}

// Build markdown
const date = new Date().toISOString().split('T')[0];
const lines = [`# Open PRs for @${username}`, `_Generated: ${date}_`, ''];

const repos = Object.keys(byRepo).sort();
for (const repo of repos) {
	lines.push(`## ${repo}`);
	lines.push('');
	for (const pr of byRepo[repo]) {
		const labels =
			pr.labels && pr.labels.length > 0
				? ' ' + pr.labels.map((l) => `\`${l.name}\``).join(' ')
				: '';
		const draft = pr.draft ? ' _(draft)_' : '';
		lines.push(`- [#${pr.number}](${pr.html_url}) ${pr.title}${draft}${labels}`);
	}
	lines.push('');
}

const output = lines.join('\n');
process.stdout.write(output);

if (values.output) {
	writeFileSync(values.output, output);
	process.stderr.write(`\nSaved to: ${values.output}\n`);
}
