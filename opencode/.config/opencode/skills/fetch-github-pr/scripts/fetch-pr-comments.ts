#!/usr/bin/env npx ts-node
/**
 * Fetch GitHub PR comments and save to markdown
 * Usage: npx ts-node fetch-pr-comments.ts --pr "owner/repo#123" [--jiraIssueId "EN-1234"]
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import { parseArgs } from 'util';

interface PRReviewComment {
	id: number;
	path: string;
	line: number | null;
	original_line: number | null;
	start_line: number | null;
	body: string;
	user: {
		login: string;
	};
	created_at: string;
	updated_at: string;
	in_reply_to_id?: number;
	diff_hunk?: string;
}

interface PRIssueComment {
	id: number;
	body: string;
	user: {
		login: string;
	};
	created_at: string;
	updated_at: string;
}

interface FileComment {
	line: number | null;
	mainComment: PRReviewComment;
	replies: PRReviewComment[];
}

interface FileComments {
	[filePath: string]: FileComment[];
}

function extractPRInfo(input: string): {
	owner: string;
	repo: string;
	prNumber: number;
} {
	// Handle full URL: https://github.com/owner/repo/pull/123
	const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (urlMatch) {
		return {
			owner: urlMatch[1],
			repo: urlMatch[2],
			prNumber: parseInt(urlMatch[3], 10),
		};
	}

	// Handle short format: owner/repo#123
	const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (shortMatch) {
		return {
			owner: shortMatch[1],
			repo: shortMatch[2],
			prNumber: parseInt(shortMatch[3], 10),
		};
	}

	// Handle just PR number (assumes current repo)
	const numberMatch = input.match(/^#?(\d+)$/);
	if (numberMatch) {
		// Get current repo info from git remote
		try {
			const remoteUrl = execSync('git remote get-url origin', {
				encoding: 'utf-8',
			}).trim();
			const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
			if (repoMatch) {
				return {
					owner: repoMatch[1],
					repo: repoMatch[2],
					prNumber: parseInt(numberMatch[1], 10),
				};
			}
		} catch {
			// Fall through to error
		}
		throw new Error(
			'Could not determine repository from git remote. Please provide full PR URL or owner/repo#number format.',
		);
	}

	throw new Error(
		`Invalid PR format: ${input}. Use URL (https://github.com/owner/repo/pull/123), short format (owner/repo#123), or PR number (#123)`,
	);
}

/**
 * Extract Jira issue ID from text (e.g., "EN-1234", "PROJ-567")
 * Jira issue IDs follow the pattern: PROJECT_KEY-NUMBER
 */
function extractJiraIssueId(text: string): string | null {
	const match = text.match(/([A-Z]+-\d+)/);
	return match ? match[1] : null;
}

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleString();
}

function escapeMarkdown(text: string): string {
	// Don't escape code blocks, just return as-is
	return text;
}

function organizeCommentsByFile(comments: PRReviewComment[]): FileComments {
	const fileComments: FileComments = {};
	const commentMap = new Map<number, PRReviewComment>();

	// First pass: index all comments by ID
	for (const comment of comments) {
		commentMap.set(comment.id, comment);
	}

	// Second pass: organize into threads
	const processedIds = new Set<number>();

	for (const comment of comments) {
		if (processedIds.has(comment.id)) continue;

		// Find the root comment of this thread
		let rootComment = comment;
		while (
			rootComment.in_reply_to_id &&
			commentMap.has(rootComment.in_reply_to_id)
		) {
			rootComment = commentMap.get(rootComment.in_reply_to_id)!;
		}

		if (processedIds.has(rootComment.id)) continue;

		// Collect all replies to this root comment
		const replies: PRReviewComment[] = [];
		for (const c of comments) {
			if (c.in_reply_to_id === rootComment.id) {
				replies.push(c);
				processedIds.add(c.id);
			}
		}
		processedIds.add(rootComment.id);

		// Sort replies by creation date
		replies.sort(
			(a, b) =>
				new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
		);

		const filePath = rootComment.path || '_no_file_';
		if (!fileComments[filePath]) {
			fileComments[filePath] = [];
		}

		fileComments[filePath].push({
			line: rootComment.line || rootComment.original_line,
			mainComment: rootComment,
			replies,
		});
	}

	// Sort comments within each file by line number
	for (const filePath of Object.keys(fileComments)) {
		fileComments[filePath].sort((a, b) => {
			const lineA = a.line ?? Infinity;
			const lineB = b.line ?? Infinity;
			return lineA - lineB;
		});
	}

	return fileComments;
}

function generateMarkdown(
	prInfo: { owner: string; repo: string; prNumber: number },
	prTitle: string,
	fileComments: FileComments,
	issueComments: PRIssueComment[],
): string {
	let markdown = `# PR Comments: ${prInfo.owner}/${prInfo.repo}#${prInfo.prNumber}\n\n`;
	markdown += `**Title:** ${prTitle}\n`;
	markdown += `**URL:** https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}\n\n`;

	// File-specific comments
	const fileKeys = Object.keys(fileComments)
		.filter((k) => k !== '_no_file_')
		.sort();

	if (fileKeys.length > 0) {
		markdown += `## File Comments\n\n`;

		for (const filePath of fileKeys) {
			const comments = fileComments[filePath];
			markdown += `### \`${filePath}\`\n\n`;

			for (const thread of comments) {
				const lineInfo = thread.line
					? `Line ${thread.line}`
					: 'No specific line';
				markdown += `#### ${lineInfo}\n\n`;

				// Main comment
				const main = thread.mainComment;
				const mainEdited = main.created_at !== main.updated_at;
				markdown += `**@${main.user.login}** - ${formatDate(main.created_at)}${mainEdited ? ` (edited: ${formatDate(main.updated_at)})` : ''}\n\n`;
				markdown += `${escapeMarkdown(main.body)}\n\n`;

				// Replies
				if (thread.replies.length > 0) {
					for (const reply of thread.replies) {
						const replyEdited = reply.created_at !== reply.updated_at;
						markdown += `> **@${reply.user.login}** - ${formatDate(reply.created_at)}${replyEdited ? ` (edited)` : ''}\n`;
						// Indent reply body with blockquote
						const replyLines = reply.body.split('\n');
						for (const line of replyLines) {
							markdown += `> ${line}\n`;
						}
						markdown += `\n`;
					}
				}

				markdown += `---\n\n`;
			}
		}
	}

	// Non-file comments (general PR comments)
	const hasGeneralComments =
		issueComments.length > 0 || fileComments['_no_file_']?.length > 0;

	if (hasGeneralComments) {
		markdown += `## General Comments\n\n`;
		markdown += `*Comments not attached to specific files or lines*\n\n`;

		// Issue comments (general PR discussion)
		for (const comment of issueComments) {
			const edited = comment.created_at !== comment.updated_at;
			markdown += `### @${comment.user.login} - ${formatDate(comment.created_at)}${edited ? ` (edited: ${formatDate(comment.updated_at)})` : ''}\n\n`;
			markdown += `${escapeMarkdown(comment.body)}\n\n`;
			markdown += `---\n\n`;
		}

		// Review comments without file association
		const noFileComments = fileComments['_no_file_'] || [];
		for (const thread of noFileComments) {
			const main = thread.mainComment;
			const mainEdited = main.created_at !== main.updated_at;
			markdown += `### @${main.user.login} - ${formatDate(main.created_at)}${mainEdited ? ` (edited: ${formatDate(main.updated_at)})` : ''}\n\n`;
			markdown += `${escapeMarkdown(main.body)}\n\n`;

			for (const reply of thread.replies) {
				const replyEdited = reply.created_at !== reply.updated_at;
				markdown += `> **@${reply.user.login}** - ${formatDate(reply.created_at)}${replyEdited ? ` (edited)` : ''}\n`;
				const replyLines = reply.body.split('\n');
				for (const line of replyLines) {
					markdown += `> ${line}\n`;
				}
				markdown += `\n`;
			}

			markdown += `---\n\n`;
		}
	}

	if (fileKeys.length === 0 && !hasGeneralComments) {
		markdown += `*No comments found on this PR*\n`;
	}

	return markdown;
}

async function main() {
	const { values } = parseArgs({
		options: {
			pr: { type: 'string', short: 'p' },
			jiraIssueId: { type: 'string', short: 'j' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	if (values.help || !values.pr) {
		console.log(`
Usage: npx ts-node fetch-pr-comments.ts --pr <pr-identifier> [--jiraIssueId <id>]

Arguments:
  --pr, -p         GitHub PR identifier (required)
                   Formats: URL, owner/repo#123, or PR number
  --jiraIssueId, -j  Optional Jira issue ID for folder naming
  --help, -h       Show this help message

Examples:
  npx ts-node fetch-pr-comments.ts --pr "https://github.com/owner/repo/pull/123"
  npx ts-node fetch-pr-comments.ts --pr "owner/repo#123"
  npx ts-node fetch-pr-comments.ts --pr "123" --jiraIssueId "EN-4526"
`);
		process.exit(values.help ? 0 : 1);
	}

	try {
		const prInfo = extractPRInfo(values.pr);
		const { owner, repo, prNumber } = prInfo;

		// Fetch PR details
		let prTitle: string;
		try {
			const prJson = execSync(
				`gh pr view ${prNumber} --repo ${owner}/${repo} --json title`,
				{ encoding: 'utf-8' },
			);
			const prData = JSON.parse(prJson);
			prTitle = prData.title;
		} catch (error) {
			throw new Error(
				`Failed to fetch PR details. Make sure you have 'gh' CLI installed and authenticated. Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Determine the issue ID for the folder
		let issueId: string;
		if (values.jiraIssueId) {
			// Use explicitly provided Jira issue ID
			issueId = values.jiraIssueId.toUpperCase();
		} else {
			// Try to extract Jira issue ID from PR title
			const extractedId = extractJiraIssueId(prTitle);
			if (extractedId) {
				issueId = extractedId;
			} else {
				// Fall back to pr-{number} format
				issueId = `pr-${prNumber}`;
			}
		}

		// Fetch review comments (file-specific comments)
		let reviewComments: PRReviewComment[] = [];
		try {
			const reviewJson = execSync(
				`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
				{ encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
			);
			reviewComments = JSON.parse(reviewJson);
		} catch (error) {
			console.error(
				`Warning: Could not fetch review comments: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Fetch issue comments (general PR comments)
		let issueComments: PRIssueComment[] = [];
		try {
			const issueJson = execSync(
				`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`,
				{ encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
			);
			issueComments = JSON.parse(issueJson);
		} catch (error) {
			console.error(
				`Warning: Could not fetch issue comments: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Organize comments by file
		const fileComments = organizeCommentsByFile(reviewComments);

		// Generate markdown
		const markdown = generateMarkdown(
			prInfo,
			prTitle,
			fileComments,
			issueComments,
		);

		// Create directory under issues/[issueId] and save file
		const issueDir = join(process.cwd(), 'issues', issueId);
		await mkdir(issueDir, { recursive: true });

		const filename = `pr-comments-${owner}-${repo}-${prNumber}.md`;
		const filePath = join(issueDir, filename);
		await writeFile(filePath, markdown, 'utf-8');

		// Count statistics
		const fileCount = Object.keys(fileComments).filter(
			(k) => k !== '_no_file_',
		).length;
		const reviewCommentCount = reviewComments.length;
		const issueCommentCount = issueComments.length;

		// Output summary
		console.log(`Successfully fetched comments for PR #${prNumber}\n`);
		console.log(`**Repository:** ${owner}/${repo}`);
		console.log(`**PR Title:** ${prTitle}`);
		console.log(`**Issue ID:** ${issueId}`);
		console.log(
			`**Review Comments:** ${reviewCommentCount} (across ${fileCount} files)`,
		);
		console.log(`**General Comments:** ${issueCommentCount}`);
		console.log(`\n**Saved to:** ${filePath}`);
	} catch (error) {
		console.error(
			`Failed to fetch PR comments: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

main();
