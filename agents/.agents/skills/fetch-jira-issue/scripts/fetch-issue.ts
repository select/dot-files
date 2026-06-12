#!/usr/bin/env bun
/**
 * Fetch Jira issue with attachments and save to markdown
 * Usage: bun fetch-issue.ts --issue "EN-4526"
 */

import { writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { parseArgs } from 'util';

interface JiraContentItem {
	type: string;
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string }>;
	content?: JiraContentItem[];
}

interface JiraContent {
	type: string;
	content?: JiraContentItem[];
}

// Module-level media ID to filename map, set before conversion
let mediaIdMap: Record<string, string> = {};

interface JiraIssue {
	id: string;
	key: string;
	fields: {
		summary: string;
		description?: {
			content: Array<JiraContent>;
		};
		status: { name: string };
		priority?: { name: string };
		assignee?: { displayName: string };
		reporter?: { displayName: string };
		created: string;
		updated: string;
		issuetype: { name: string };
		labels?: string[];
		attachment?: Array<{
			id: string;
			filename: string;
			content: string;
			mimeType: string;
		}>;
		[key: string]: unknown;
	};
}

interface JiraComment {
	id: string;
	author: {
		displayName: string;
		emailAddress?: string;
	};
	body: {
		content: Array<JiraContent>;
	};
	created: string;
	updated: string;
}

interface JiraCommentsResponse {
	comments: JiraComment[];
	total: number;
}

interface PullRequest {
	id: string;
	name: string;
	url: string;
	status: string;
	author?: {
		name: string;
	};
	sourceBranch?: string;
	destinationBranch?: string;
	lastUpdate?: string;
}

interface DevInfoDetail {
	pullRequests?: PullRequest[];
}

interface DevInfoResponse {
	detail?: DevInfoDetail[];
}

function extractIssueKey(input: string): string {
	// If it's a URL, extract the issue key
	const urlMatch = input.match(/browse\/([A-Z]+-\d+)/);
	if (urlMatch) {
		return urlMatch[1];
	}
	// If it's already an issue key format
	const keyMatch = input.match(/^([A-Z]+-\d+)$/);
	if (keyMatch) {
		return keyMatch[1];
	}
	throw new Error(`Invalid Jira issue format: ${input}`);
}

function convertDescriptionToMarkdown(
	description: JiraIssue['fields']['description'],
): string {
	if (!description?.content) return '';
	// Use the full convertContentToMarkdown function for proper nested list handling
	return convertContentToMarkdown(description.content);
}

function convertContentToMarkdown(content: Array<JiraContent>): string {
	if (!content) return '';

	let markdown = '';

	function processInlineContent(items: unknown[]): string {
		return items
			.map((item) => {
				const i = item as {
					type: string;
					text?: string;
					marks?: Array<{ type: string; attrs?: { href?: string } }>;
					attrs?: { text?: string; url?: string };
				};
				if (i.type === 'text') {
					let text = i.text || '';
					// Apply marks (bold, italic, etc.)
					if (i.marks) {
						for (const mark of i.marks) {
							if (mark.type === 'strong') text = `**${text}**`;
							if (mark.type === 'em') text = `*${text}*`;
							if (mark.type === 'code') text = `\`${text}\``;
							if (mark.type === 'link') {
								const href = mark.attrs?.href || '';
								text = `[${text}](${href})`;
							}
							// textColor mark is ignored (no markdown equivalent)
						}
					}
					return text;
				} else if (i.type === 'mention') {
					return `@${i.attrs?.text || 'user'}`;
				} else if (i.type === 'inlineCard') {
					// Handle inline cards (links without text)
					const url = i.attrs?.url || '';
					return url;
				} else if (i.type === 'hardBreak') {
					return '\n';
				}
				return '';
			})
			.join('');
	}

	function processListItem(
		item: unknown,
		indent: string,
		isOrdered: boolean,
		index: number,
	): string {
		let result = '';
		const prefix = isOrdered ? `${index + 1}.` : '-';
		const listItem = item as {
			content?: Array<{
				type: string;
				content?: unknown[];
				attrs?: { language?: string };
			}>;
		};

		// Process the list item content
		if (listItem.content) {
			for (let i = 0; i < listItem.content.length; i++) {
				const child = listItem.content[i];

				if (child.type === 'paragraph') {
					const paragraphText = child.content
						? processInlineContent(child.content)
						: '';

					if (i === 0) {
						// First paragraph goes on the same line as the bullet
						result += `${indent}${prefix} ${paragraphText}\n`;
					} else {
						// Subsequent paragraphs are indented
						result += `${indent}  ${paragraphText}\n`;
					}
				} else if (
					child.type === 'bulletList' ||
					child.type === 'orderedList'
				) {
					// Handle nested lists
					const nestedItems = (child as { content?: unknown[] }).content || [];
					nestedItems.forEach((nestedItem: unknown, nestedIndex: number) => {
						result += processListItem(
							nestedItem,
							indent + '  ',
							child.type === 'orderedList',
							nestedIndex,
						);
					});
				} else if (child.type === 'codeBlock') {
					const language = child.attrs?.language || '';
					const codeText =
						(child.content as Array<{ text?: string }> | undefined)
							?.map((item) => item.text || '')
							.join('') || '';
					// Indent code blocks within list items
					const indentedCode = codeText
						.split('\n')
						.map((line: string) => `${indent}  ${line}`)
						.join('\n');
					result += `${indent}  \`\`\`${language}\n${indentedCode}\n${indent}  \`\`\`\n`;
				}
			}
		}

		return result;
	}

	for (const block of content) {
		if (block.type === 'paragraph') {
			const paragraphText = block.content
				? processInlineContent(block.content)
				: '';
			markdown += paragraphText + '\n\n';
		} else if (block.type === 'heading') {
			const level = (block as { attrs?: { level?: number } }).attrs?.level || 1;
			const headingText = block.content
				? processInlineContent(block.content)
				: '';
			markdown += `${'#'.repeat(level)} ${headingText}\n\n`;
		} else if (block.type === 'bulletList' || block.type === 'orderedList') {
			const listItems = block.content || [];
			listItems.forEach((item, index) => {
				markdown += processListItem(
					item,
					'',
					block.type === 'orderedList',
					index,
				);
			});
			markdown += '\n';
		} else if (block.type === 'codeBlock') {
			const language =
				(block as { attrs?: { language?: string } }).attrs?.language || '';
			const codeText = block.content?.map((item) => item.text || '').join('');
			markdown += `\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
		} else if (block.type === 'blockquote') {
			// Handle blockquotes
			const quoteText = block.content
				?.map((p) =>
					(p as { content?: unknown[] }).content
						? processInlineContent((p as { content?: unknown[] }).content!)
						: '',
				)
				.join('\n');
			markdown += `> ${quoteText}\n\n`;
		} else if (block.type === 'rule') {
			// Handle horizontal rules
			markdown += '---\n\n';
		} else if (block.type === 'expand') {
			// Handle expand/collapse sections
			const expandBlock = block as { attrs?: { title?: string }; content?: Array<JiraContent> };
			const title = expandBlock.attrs?.title || 'Details';
			markdown += `<details>\n<summary>${title}</summary>\n\n`;
			if (expandBlock.content) {
				markdown += convertContentToMarkdown(expandBlock.content) + '\n\n';
			}
			markdown += `</details>\n\n`;
		} else if (block.type === 'blockCard') {
			// Handle block-level link cards
			const cardBlock = block as { attrs?: { url?: string } };
			const url = cardBlock.attrs?.url || '';
			if (url) {
				markdown += `${url}\n\n`;
			}
		} else if (block.type === 'mediaGroup' || block.type === 'mediaSingle') {
			// Handle media groups and single media (inline file attachments / images)
			const mediaItems = block.content || [];
			for (const media of mediaItems) {
				const mediaNode = media as { attrs?: { id?: string; type?: string } };
				const mediaId = mediaNode.attrs?.id;
				if (mediaId && mediaIdMap[mediaId]) {
					markdown += `@${mediaIdMap[mediaId]}\n`;
				} else {
					markdown += `📎 *(unresolved attached file)*\n`;
				}
			}
			markdown += '\n';
		} else if (block.type === 'table') {
			// Handle tables
			const rows = block.content || [];
			for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
				const row = rows[rowIdx] as { content?: Array<{ type: string; content?: Array<JiraContent> }> };
				const cells = row.content || [];
				const cellTexts = cells.map(cell => {
					if (cell.content) {
						return cell.content.map(p => (p as { content?: unknown[] }).content ? processInlineContent((p as { content?: unknown[] }).content!) : '').join(' ');
					}
					return '';
				});
				markdown += `| ${cellTexts.join(' | ')} |\n`;
				if (rowIdx === 0) {
					markdown += `| ${cellTexts.map(() => '---').join(' | ')} |\n`;
				}
			}
			markdown += '\n';
		}
	}

	return markdown.trim();
}

function generateIssueMarkdown(
	issue: JiraIssue,
	comments: JiraComment[],
	devInfo?: DevInfoDetail,
): string {
	const { key, fields } = issue;
	const description = convertDescriptionToMarkdown(fields.description);

	let markdown = `# ${key}: ${fields.summary}\n\n`;
	markdown += `**Type:** ${fields.issuetype.name}\n`;
	markdown += `**Status:** ${fields.status.name}\n`;
	if (fields.priority) {
		markdown += `**Priority:** ${fields.priority.name}\n`;
	}
	if (fields.assignee) {
		markdown += `**Assignee:** ${fields.assignee.displayName}\n`;
	}
	if (fields.reporter) {
		markdown += `**Reporter:** ${fields.reporter.displayName}\n`;
	}
	markdown += `**Created:** ${new Date(fields.created).toLocaleString()}\n`;
	markdown += `**Updated:** ${new Date(fields.updated).toLocaleString()}\n`;

	if (fields.labels && fields.labels.length > 0) {
		markdown += `**Labels:** ${fields.labels.join(', ')}\n`;
	}

	markdown += `\n## Description\n\n${description || '*No description provided*'}\n`;

	if (fields.attachment && fields.attachment.length > 0) {
		markdown += `\n## Attachments\n\n`;
		fields.attachment.forEach((att) => {
			markdown += `- [${att.filename}](./${att.filename})\n`;
		});
	}

	// Add Pull Requests section
	if (devInfo?.pullRequests && devInfo.pullRequests.length > 0) {
		markdown += `\n## Pull Requests (${devInfo.pullRequests.length})\n\n`;
		for (const pr of devInfo.pullRequests) {
			const statusLabel =
				pr.status === 'MERGED'
					? '[MERGED]'
					: pr.status === 'OPEN'
						? '[OPEN]'
						: pr.status === 'DECLINED'
							? '[DECLINED]'
							: `[${pr.status}]`;
			markdown += `- ${statusLabel} [${pr.name}](${pr.url})`;
			if (pr.author?.name) {
				markdown += ` by ${pr.author.name}`;
			}
			markdown += `\n`;
			// Add URL on separate line for easy use with github-pr-comments tool
			markdown += `  \`${pr.url}\`\n`;
		}
	}

	if (comments.length > 0) {
		markdown += `\n## Discussion (${comments.length} comment${comments.length > 1 ? 's' : ''})\n\n`;
		comments.forEach((comment, index) => {
			const commentBody = convertContentToMarkdown(comment.body.content);
			const createdDate = new Date(comment.created).toLocaleString();
			const updatedDate = new Date(comment.updated).toLocaleString();
			const isEdited = comment.created !== comment.updated;

			markdown += `### Comment ${index + 1} - ${comment.author.displayName}\n`;
			markdown += `*Posted: ${createdDate}${isEdited ? ` (edited: ${updatedDate})` : ''}*\n\n`;
			markdown += `${commentBody || '*No content*'}\n\n`;
			markdown += `---\n\n`;
		});
	}

	return markdown;
}

async function main() {
	const { values } = parseArgs({
		options: {
			issue: { type: 'string', short: 'i' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	if (values.help || !values.issue) {
		console.log(`
Usage: bun fetch-issue.ts --issue <issue-identifier>

Arguments:
  --issue, -i      Jira issue ID or URL (required)
                   Formats: EN-4526 or https://apheris.atlassian.net/browse/EN-4526
  --help, -h       Show this help message

Environment Variables:
  JIRA_URL         Jira instance URL (required)
  JIRA_USERNAME    Jira username/email (required)
  JIRA_API_TOKEN   Jira API token (required)
  JIRA_DEBUG       Set to "true" to save raw JSON responses

Examples:
  bun fetch-issue.ts --issue "EN-4526"
  bun fetch-issue.ts --issue "https://apheris.atlassian.net/browse/EN-4526"
`);
		process.exit(values.help ? 0 : 1);
	}

	const JIRA_URL = process.env.JIRA_URL;
	const JIRA_USERNAME = process.env.JIRA_USERNAME;
	const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

	if (!JIRA_URL || !JIRA_USERNAME || !JIRA_API_TOKEN) {
		const missing: string[] = [];
		if (!JIRA_URL) missing.push('JIRA_URL');
		if (!JIRA_USERNAME) missing.push('JIRA_USERNAME');
		if (!JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
		console.error(
			`Missing required environment variables: ${missing.join(', ')}`,
		);
		process.exit(1);
	}

	try {
		const issueKey = extractIssueKey(values.issue);
		const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString(
			'base64',
		);

		// Fetch the issue from Jira API
		const url = `${JIRA_URL}/rest/api/3/issue/${issueKey}`;
		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Authorization: `Basic ${auth}`,
					Accept: 'application/json',
				},
			});
		} catch (error) {
			throw new Error(
				`Network error fetching issue: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (!response.ok) {
			throw new Error(
				`Failed to fetch issue: ${url} ${response.status} ${response.statusText}`,
			);
		}

		const issue: JiraIssue = await response.json();

		// Fetch rendered fields to build media ID -> filename map
		try {
			const renderedUrl = `${JIRA_URL}/rest/api/3/issue/${issueKey}?expand=renderedFields&fields=description,comment`;
			const renderedResponse = await fetch(renderedUrl, {
				headers: {
					Authorization: `Basic ${auth}`,
					Accept: 'application/json',
				},
			});
			if (renderedResponse.ok) {
				const renderedData = await renderedResponse.json();
				const renderedHtml = [
					renderedData.renderedFields?.description || '',
					...(renderedData.renderedFields?.comment?.comments?.map(
						(c: { body?: string }) => c.body || '',
					) || []),
				].join('');
				const mediaRegex =
					/data-media-services-id="([^"]+)"[^>]*data-attachment-name="([^"]+)"/g;
				let mediaMatch;
				while ((mediaMatch = mediaRegex.exec(renderedHtml)) !== null) {
					mediaIdMap[mediaMatch[1]] = mediaMatch[2];
				}
				// Also try reversed attribute order
				const mediaRegex2 =
					/data-attachment-name="([^"]+)"[^>]*data-media-services-id="([^"]+)"/g;
				while ((mediaMatch = mediaRegex2.exec(renderedHtml)) !== null) {
					mediaIdMap[mediaMatch[2]] = mediaMatch[1];
				}
			}
		} catch (error) {
			// Non-fatal: media references will show as unresolved
			console.error(
				`Warning: Could not fetch rendered fields for media mapping: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Fetch comments for the issue
		const commentsUrl = `${JIRA_URL}/rest/api/3/issue/${issueKey}/comment`;
		let commentsResponse: Response;
		try {
			commentsResponse = await fetch(commentsUrl, {
				headers: {
					Authorization: `Basic ${auth}`,
					Accept: 'application/json',
				},
			});
		} catch (error) {
			console.error(
				`Network error fetching comments: ${error instanceof Error ? error.message : String(error)}`,
			);
			commentsResponse = new Response(null, { status: 500 });
		}

		let comments: JiraComment[] = [];
		if (commentsResponse.ok) {
			const commentsData: JiraCommentsResponse = await commentsResponse.json();
			comments = commentsData.comments || [];
		} else if (commentsResponse.status !== 500) {
			console.error(
				`Failed to fetch comments: ${commentsUrl} ${commentsResponse.status} ${commentsResponse.statusText}`,
			);
		}

		// Fetch development information (PRs)
		let devInfo: DevInfoDetail | undefined;
		try {
			const devInfoUrl = `${JIRA_URL}/rest/dev-status/latest/issue/detail?issueId=${issue.id}&applicationType=GitHub&dataType=pullrequest`;
			const devInfoResponse = await fetch(devInfoUrl, {
				headers: {
					Authorization: `Basic ${auth}`,
					Accept: 'application/json',
				},
			});

			if (devInfoResponse.ok) {
				const devInfoData: DevInfoResponse = await devInfoResponse.json();
				if (devInfoData.detail && devInfoData.detail.length > 0) {
					devInfo = {
						pullRequests: devInfoData.detail.flatMap(
							(d) => d.pullRequests || [],
						),
					};
				}
			}
		} catch (error) {
			console.error(
				`Warning: Could not fetch development info: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Create directory for the issue
		const issueDir = join(process.cwd(), 'issues', issueKey);
		await mkdir(issueDir, { recursive: true });

		// Save raw JSON for debugging if JIRA_DEBUG is set
		if (process.env.JIRA_DEBUG === 'true') {
			await writeFile(
				join(issueDir, 'issue.json'),
				JSON.stringify(issue, null, 2),
				'utf-8',
			);
			if (comments.length > 0) {
				await writeFile(
					join(issueDir, 'comments.json'),
					JSON.stringify(comments, null, 2),
					'utf-8',
				);
			}
			if (devInfo) {
				await writeFile(
					join(issueDir, 'devinfo.json'),
					JSON.stringify(devInfo, null, 2),
					'utf-8',
				);
			}
		}

		// Download attachments if any
		const attachments = issue.fields.attachment || [];
		const downloadedAttachments: string[] = [];

		for (const attachment of attachments) {
			try {
				let attResponse: Response;
				try {
					attResponse = await fetch(attachment.content, {
						headers: {
							Authorization: `Basic ${auth}`,
						},
					});
				} catch (error) {
					console.error(
						`Network error downloading attachment ${attachment.filename}: ${error instanceof Error ? error.message : String(error)}`,
					);
					continue;
				}

				if (attResponse.ok) {
					const buffer = await attResponse.arrayBuffer();
					// Sanitize filename to prevent path traversal attacks
					const sanitizedFilename = basename(attachment.filename);
					const filePath = join(issueDir, sanitizedFilename);
					await writeFile(filePath, Buffer.from(buffer));
					downloadedAttachments.push(sanitizedFilename);
				} else {
					console.error(
						`Failed to download attachment ${attachment.filename}: ${attResponse.status} ${attResponse.statusText}`,
					);
				}
			} catch (error) {
				console.error(
					`Failed to download attachment ${attachment.filename}:`,
					error,
				);
			}
		}

		// Generate and save markdown file
		const markdown = generateIssueMarkdown(issue, comments, devInfo);
		const mdPath = join(issueDir, 'issue.md');
		await writeFile(mdPath, markdown, 'utf-8');

		// Output summary
		console.log(`Successfully fetched Jira issue ${issueKey}\n`);
		console.log(`**Summary:** ${issue.fields.summary}`);
		console.log(`**Status:** ${issue.fields.status.name}`);
		console.log(`**Type:** ${issue.fields.issuetype.name}`);
		if (issue.fields.priority) {
			console.log(`**Priority:** ${issue.fields.priority.name}`);
		}
		console.log(`\n**Saved to:** ${issueDir}`);
		console.log(`**Markdown file:** ${mdPath}`);

		if (comments.length > 0) {
			console.log(`**Comments:** ${comments.length}`);
		}

		if (devInfo?.pullRequests && devInfo.pullRequests.length > 0) {
			console.log(`**Pull Requests:** ${devInfo.pullRequests.length}`);
		}

		if (downloadedAttachments.length > 0) {
			console.log(
				`\n**Downloaded ${downloadedAttachments.length} attachment(s):**`,
			);
			downloadedAttachments.forEach((att) => {
				console.log(`  - ${att}`);
			});
		}
	} catch (error) {
		console.error(
			`Failed to fetch Jira issue: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

main();
