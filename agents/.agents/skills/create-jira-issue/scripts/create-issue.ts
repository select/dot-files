#!/usr/bin/env bun

/**
 * Create Jira Issue Script (EN/AW boards)
 *
 * Creates an issue on the EN (Engineering) or AW (Apheris Web) board with proper Atlassian Document Format (ADF).
 *
 * Usage:
 *   # Via stdin (recommended for complex content):
 *   echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["..."], "issueType": "Task"}' | npx ts-node create-issue.ts --stdin
 *
 *   # Via command line arguments:
 *   npx ts-node create-issue.ts --board "EN" --title "..." --context "..." --definitionOfDone "..." --issueType "Task"
 *
 * Reads credentials from ~/.config/atlassian-jira/credentials.json
 */

import { loadJiraConfig, getAuthHeader } from './jira-config';

type Board = 'EN' | 'AW';
type IssueType = 'Task' | 'Bug' | 'Story';

interface IssueInput {
	board: Board;
	title: string;
	context: string;
	definitionOfDone: string[];
	issueType?: IssueType;
	/** File paths to attach to the issue (images/files) */
	attachments?: string[];
	/** Assignee: display name or email (resolved to accountId via search) */
	assignee?: string;
	/** Sprint name or ID to assign the issue to */
	sprint?: string | number;
}

interface JiraCreateResponse {
	id: string;
	key: string;
	self: string;
}

interface AdfNode {
	type: string;
	text?: string;
	content?: AdfNode[];
	attrs?: Record<string, unknown>;
	marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface AdfDocument {
	type: 'doc';
	version: 1;
	content: AdfNode[];
}

const VALID_BOARDS: Board[] = ['EN', 'AW'];
const VALID_ISSUE_TYPES: IssueType[] = ['Task', 'Bug', 'Story'];

// Board IDs for sprint lookup
const BOARD_IDS: Record<Board, number> = {
	EN: 22,
	AW: 373,
};

function createTextNode(
	text: string,
	marks?: { type: string; attrs?: Record<string, unknown> }[],
): AdfNode {
	const node: AdfNode = { type: 'text', text };
	if (marks && marks.length > 0) {
		node.marks = marks;
	}
	return node;
}

function createParagraph(...content: AdfNode[]): AdfNode {
	return { type: 'paragraph', content };
}

function createHeading(text: string, level: number): AdfNode {
	return {
		type: 'heading',
		attrs: { level },
		content: [createTextNode(text)],
	};
}

function createBulletList(items: string[]): AdfNode {
	return {
		type: 'bulletList',
		content: items.map((item) => ({
			type: 'listItem',
			content: [createParagraph(...parseInlineMarkdown(item))],
		})),
	};
}

function createOrderedList(items: string[]): AdfNode {
	return {
		type: 'orderedList',
		content: items.map((item) => ({
			type: 'listItem',
			content: [createParagraph(...parseInlineMarkdown(item))],
		})),
	};
}

function createCodeBlock(code: string, language?: string): AdfNode {
	const node: AdfNode = {
		type: 'codeBlock',
		content: [{ type: 'text', text: code }],
	};
	if (language) {
		node.attrs = { language };
	}
	return node;
}

/**
 * Parse inline markdown (bold, code, links) within a line of text
 */
function parseInlineMarkdown(text: string): AdfNode[] {
	const nodes: AdfNode[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		// Match **bold** or `code` or [link](url)
		const boldMatch = remaining.match(/^([\s\S]*?)\*\*(.+?)\*\*([\s\S]*)/);
		const codeMatch = remaining.match(/^([\s\S]*?)`([^`]+)`([\s\S]*)/);
		const linkMatch = remaining.match(
			/^([\s\S]*?)\[([^\]]+)\]\(([^)]+)\)([\s\S]*)/,
		);

		// Find the earliest match
		let earliestMatch: {
			type: 'bold' | 'code' | 'link';
			before: string;
			content: string;
			after: string;
			url?: string;
		} | null = null;
		let earliestIndex = Infinity;

		if (
			boldMatch &&
			boldMatch[1] !== undefined &&
			boldMatch[2] !== undefined &&
			boldMatch[3] !== undefined &&
			boldMatch[1].length < earliestIndex
		) {
			earliestIndex = boldMatch[1].length;
			earliestMatch = {
				type: 'bold',
				before: boldMatch[1],
				content: boldMatch[2],
				after: boldMatch[3],
			};
		}
		if (
			codeMatch &&
			codeMatch[1] !== undefined &&
			codeMatch[2] !== undefined &&
			codeMatch[3] !== undefined &&
			codeMatch[1].length < earliestIndex
		) {
			earliestIndex = codeMatch[1].length;
			earliestMatch = {
				type: 'code',
				before: codeMatch[1],
				content: codeMatch[2],
				after: codeMatch[3],
			};
		}
		if (
			linkMatch &&
			linkMatch[1] !== undefined &&
			linkMatch[2] !== undefined &&
			linkMatch[3] !== undefined &&
			linkMatch[4] !== undefined &&
			linkMatch[1].length < earliestIndex
		) {
			earliestIndex = linkMatch[1].length;
			earliestMatch = {
				type: 'link',
				before: linkMatch[1],
				content: linkMatch[2],
				after: linkMatch[4],
				url: linkMatch[3],
			};
		}

		if (earliestMatch) {
			// Add text before the match
			if (earliestMatch.before) {
				nodes.push(createTextNode(earliestMatch.before));
			}
			// Add the formatted content
			if (earliestMatch.type === 'bold') {
				nodes.push(createTextNode(earliestMatch.content, [{ type: 'strong' }]));
			} else if (earliestMatch.type === 'code') {
				nodes.push(createTextNode(earliestMatch.content, [{ type: 'code' }]));
			} else if (earliestMatch.type === 'link') {
				nodes.push(
					createTextNode(earliestMatch.content, [
						{ type: 'link', attrs: { href: earliestMatch.url } },
					]),
				);
			}
			remaining = earliestMatch.after;
		} else {
			// No more matches, add the rest as plain text
			if (remaining) {
				nodes.push(createTextNode(remaining));
			}
			break;
		}
	}

	return nodes.length > 0 ? nodes : [createTextNode('')];
}

/**
 * Parse markdown text into ADF nodes
 */
function parseMarkdownToAdf(markdown: string): AdfNode[] {
	const nodes: AdfNode[] = [];
	const lines = markdown.split('\n');
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? '';

		// Code block (```language ... ```)
		if (line.startsWith('```')) {
			const language = line.slice(3).trim() || undefined;
			const codeLines: string[] = [];
			i++;
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				if (currentLine.startsWith('```')) {
					break;
				}
				codeLines.push(currentLine);
				i++;
			}
			nodes.push(createCodeBlock(codeLines.join('\n'), language));
			i++; // skip closing ```
			continue;
		}

		// Numbered list (1. item, 2. item, etc.)
		if (/^\d+\.\s/.test(line)) {
			const listItems: string[] = [];
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				if (!/^\d+\.\s/.test(currentLine)) {
					break;
				}
				listItems.push(currentLine.replace(/^\d+\.\s/, ''));
				i++;
			}
			nodes.push(createOrderedList(listItems));
			continue;
		}

		// Bullet list (- item or * item)
		if (/^[-*]\s/.test(line)) {
			const listItems: string[] = [];
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				if (!/^[-*]\s/.test(currentLine)) {
					break;
				}
				listItems.push(currentLine.replace(/^[-*]\s/, ''));
				i++;
			}
			nodes.push(createBulletList(listItems));
			continue;
		}

		// Empty line - skip
		if (line.trim() === '') {
			i++;
			continue;
		}

		// Regular paragraph - collect consecutive non-empty, non-special lines
		const paragraphLines: string[] = [];
		while (i < lines.length) {
			const currentLine = lines[i] ?? '';
			if (
				currentLine.trim() === '' ||
				currentLine.startsWith('```') ||
				/^\d+\.\s/.test(currentLine) ||
				/^[-*]\s/.test(currentLine)
			) {
				break;
			}
			paragraphLines.push(currentLine);
			i++;
		}

		if (paragraphLines.length > 0) {
			const paragraphText = paragraphLines.join('\n');
			nodes.push(createParagraph(...parseInlineMarkdown(paragraphText)));
		}
	}

	return nodes;
}

function buildIssueDescription(input: IssueInput): AdfDocument {
	const content: AdfNode[] = [];

	// Context section
	content.push(createHeading('Context', 2));
	content.push(...parseMarkdownToAdf(input.context));

	// Definition of Done section
	content.push(createHeading('Definition of Done', 2));
	if (input.definitionOfDone.length > 0) {
		content.push(createBulletList(input.definitionOfDone));
	}

	return {
		type: 'doc',
		version: 1,
		content,
	};
}

/**
 * Build wiki markup description for use with v2 API (supports inline images)
 */
function buildWikiMarkupDescription(
	input: IssueInput,
	attachmentFilenames: string[],
): string {
	const lines: string[] = [];

	lines.push('h2. Context');
	lines.push('');
	const wikiContext = convertMarkdownToWiki(input.context, attachmentFilenames);
	lines.push(wikiContext);
	lines.push('');

	// Append any attached images that weren't already referenced inline
	const unreferencedFiles = attachmentFilenames.filter(
		(filename) => !wikiContext.includes(`!${filename}`),
	);
	if (unreferencedFiles.length > 0) {
		lines.push('');
		for (const filename of unreferencedFiles) {
			lines.push(`!${filename}|width=600!`);
			lines.push('');
		}
	}

	lines.push('h2. Definition of Done');
	lines.push('');
	for (const item of input.definitionOfDone) {
		lines.push(`* ${item}`);
	}

	return lines.join('\n');
}

/**
 * Convert markdown text to Jira wiki markup, embedding image attachments inline
 */
function convertMarkdownToWiki(
	markdown: string,
	attachmentFilenames: string[],
): string {
	let result = markdown;

	// Embed image references FIRST (before link conversion eats them)
	// Match patterns like ![alt](path/to/filename) where path ends with the attachment filename
	for (const filename of attachmentFilenames) {
		const mdImageRegex = new RegExp(
			`!\\[[^\\]]*\\]\\([^)]*${escapeRegex(filename)}\\)`,
			'g',
		);
		result = result.replace(mdImageRegex, `!${filename}|width=600!`);
	}

	// Convert **bold** to *bold*
	result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

	// Convert `code` to {{code}}
	result = result.replace(/`([^`]+)`/g, '{{$1}}');

	// Convert [text](url) to [text|url]
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');

	// Convert markdown code blocks to {code}
	result = result.replace(
		/```(\w*)\n([\s\S]*?)```/g,
		(_match, lang, code) =>
			`{code${lang ? ':language=' + lang : ''}}\n${code.trimEnd()}\n{code}`,
	);

	// Convert numbered lists: "1. item" -> "# item"
	result = result.replace(/^\d+\.\s(.+)$/gm, '# $1');

	// Convert bullet lists: "- item" -> "* item"
	result = result.replace(/^- (.+)$/gm, '* $1');

	return result;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateInput(input: unknown): IssueInput {
	if (!input || typeof input !== 'object') {
		throw new Error('Input must be a JSON object');
	}

	const obj = input as Record<string, unknown>;

	if (!obj.board || typeof obj.board !== 'string') {
		throw new Error('board is required and must be a string (EN or AW)');
	}

	const board = obj.board.toUpperCase() as Board;
	if (!VALID_BOARDS.includes(board)) {
		throw new Error(`board must be one of: ${VALID_BOARDS.join(', ')}`);
	}

	if (!obj.title || typeof obj.title !== 'string' || !obj.title.trim()) {
		throw new Error('title is required and must be a non-empty string');
	}

	if (!obj.context || typeof obj.context !== 'string' || !obj.context.trim()) {
		throw new Error('context is required and must be a non-empty string');
	}

	if (!obj.definitionOfDone || !Array.isArray(obj.definitionOfDone)) {
		throw new Error(
			'definitionOfDone is required and must be an array of strings',
		);
	}

	const definitionOfDone = obj.definitionOfDone.filter(
		(item): item is string => typeof item === 'string' && item.trim() !== '',
	);

	if (definitionOfDone.length === 0) {
		throw new Error(
			'definitionOfDone must contain at least one non-empty string',
		);
	}

	let issueType: IssueType = 'Task';
	if (obj.issueType) {
		if (typeof obj.issueType !== 'string') {
			throw new Error('issueType must be a string');
		}
		const normalizedType =
			obj.issueType.charAt(0).toUpperCase() +
			obj.issueType.slice(1).toLowerCase();
		if (!VALID_ISSUE_TYPES.includes(normalizedType as IssueType)) {
			throw new Error(
				`issueType must be one of: ${VALID_ISSUE_TYPES.join(', ')}`,
			);
		}
		issueType = normalizedType as IssueType;
	}

	// Parse optional fields
	let attachments: string[] | undefined;
	if (obj.attachments) {
		if (!Array.isArray(obj.attachments)) {
			throw new Error('attachments must be an array of file paths');
		}
		attachments = obj.attachments.filter(
			(item): item is string => typeof item === 'string' && item.trim() !== '',
		);
	}

	const assignee =
		obj.assignee && typeof obj.assignee === 'string'
			? obj.assignee.trim()
			: undefined;

	const sprint = obj.sprint != null ? obj.sprint : undefined;

	return {
		board,
		title: obj.title.trim(),
		context: obj.context.trim(),
		definitionOfDone,
		issueType,
		attachments,
		assignee: assignee as string | undefined,
		sprint: sprint as string | number | undefined,
	};
}

function parseArgs(args: string[]): IssueInput | 'stdin' {
	if (args.includes('--stdin')) {
		return 'stdin';
	}

	const result: Partial<IssueInput> = {
		definitionOfDone: [],
		attachments: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const nextArg = args[i + 1];

		switch (arg) {
			case '--board':
				result.board = nextArg as Board;
				i++;
				break;
			case '--title':
				result.title = nextArg;
				i++;
				break;
			case '--context':
				result.context = nextArg;
				i++;
				break;
			case '--definitionOfDone':
				result.definitionOfDone!.push(nextArg!);
				i++;
				break;
			case '--issueType':
				result.issueType = nextArg as IssueType;
				i++;
				break;
			case '--attachment':
				result.attachments!.push(nextArg!);
				i++;
				break;
			case '--assignee':
				result.assignee = nextArg;
				i++;
				break;
			case '--sprint':
				result.sprint = nextArg;
				i++;
				break;
		}
	}

	return validateInput(result);
}

async function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => (data += chunk));
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', reject);
	});
}

// ─── Assignee helpers ─────────────────────────────────────────────────────────

async function resolveAssigneeAccountId(
	assigneeQuery: string,
	jiraUrl: string,
	auth: string,
): Promise<string> {
	const response = await fetch(
		`${jiraUrl}/rest/api/3/user/search?query=${encodeURIComponent(assigneeQuery)}`,
		{
			headers: { Authorization: auth, Accept: 'application/json' },
		},
	);

	if (!response.ok) {
		throw new Error(
			`Failed to search for user "${assigneeQuery}": ${response.status}`,
		);
	}

	const users = (await response.json()) as {
		accountId: string;
		displayName: string;
	}[];
	if (users.length === 0) {
		throw new Error(`No Jira user found matching "${assigneeQuery}"`);
	}

	return users[0].accountId;
}

async function assignIssue(
	issueKey: string,
	accountId: string,
	jiraUrl: string,
	auth: string,
): Promise<void> {
	const response = await fetch(
		`${jiraUrl}/rest/api/3/issue/${issueKey}/assignee`,
		{
			method: 'PUT',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ accountId }),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to assign issue ${issueKey}: ${response.status} - ${errorText}`,
		);
	}
}

// ─── Sprint helpers ───────────────────────────────────────────────────────────

async function resolveSprintId(
	sprintQuery: string | number,
	board: Board,
	jiraUrl: string,
	auth: string,
): Promise<number> {
	// If it's already a number type, use it directly as a Jira sprint ID
	if (typeof sprintQuery === 'number') {
		return sprintQuery;
	}

	// Always search by name — numeric strings like "155" refer to sprint names
	// (e.g. "EN Sprint 155"), not internal Jira sprint IDs.

	// Search by name in active/future sprints for the board
	const boardId = BOARD_IDS[board];
	const response = await fetch(
		`${jiraUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active,future`,
		{
			headers: { Authorization: auth, Accept: 'application/json' },
		},
	);

	if (!response.ok) {
		throw new Error(
			`Failed to list sprints for board ${board}: ${response.status}`,
		);
	}

	const data = (await response.json()) as {
		values: { id: number; name: string }[];
	};

	// Match by name (case-insensitive, partial match)
	const query = sprintQuery.toLowerCase();
	const sprint = data.values.find((s) =>
		s.name.toLowerCase().includes(query),
	);

	if (!sprint) {
		const available = data.values.map((s) => `  - ${s.name} (id: ${s.id})`);
		throw new Error(
			`No sprint found matching "${sprintQuery}". Available sprints:\n${available.join('\n')}`,
		);
	}

	return sprint.id;
}

async function moveIssueToSprint(
	issueKey: string,
	sprintId: number,
	jiraUrl: string,
	auth: string,
): Promise<void> {
	const response = await fetch(
		`${jiraUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
		{
			method: 'POST',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ issues: [issueKey] }),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to move ${issueKey} to sprint ${sprintId}: ${response.status} - ${errorText}`,
		);
	}
}

// ─── Attachment helpers ───────────────────────────────────────────────────────

async function uploadAttachments(
	issueKey: string,
	filePaths: string[],
	jiraUrl: string,
	auth: string,
): Promise<string[]> {
	const uploadedFilenames: string[] = [];

	for (const filePath of filePaths) {
		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			console.error(`⚠️  Attachment not found, skipping: ${filePath}`);
			continue;
		}

		const filename = filePath.split('/').pop()!;
		const formData = new FormData();
		formData.append('file', file, filename);

		const response = await fetch(
			`${jiraUrl}/rest/api/3/issue/${issueKey}/attachments`,
			{
				method: 'POST',
				headers: {
					Authorization: auth,
					'X-Atlassian-Token': 'no-check',
				},
				body: formData,
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				`⚠️  Failed to upload ${filename}: ${response.status} - ${errorText}`,
			);
			continue;
		}

		const attachments = (await response.json()) as { filename: string }[];
		for (const att of attachments) {
			uploadedFilenames.push(att.filename);
		}
	}

	return uploadedFilenames;
}

/**
 * Update the issue description using Jira v2 API with wiki markup.
 * This enables inline image rendering via !filename.png! syntax.
 */
async function updateDescriptionWithWikiMarkup(
	issueKey: string,
	input: IssueInput,
	attachmentFilenames: string[],
	jiraUrl: string,
	auth: string,
): Promise<void> {
	const wikiDescription = buildWikiMarkupDescription(
		input,
		attachmentFilenames,
	);

	const response = await fetch(`${jiraUrl}/rest/api/2/issue/${issueKey}`, {
		method: 'PUT',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ fields: { description: wikiDescription } }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to update description with wiki markup: ${response.status} - ${errorText}`,
		);
	}
}

// ─── Main issue operations ────────────────────────────────────────────────────

async function createIssue(
	input: IssueInput,
): Promise<{ success: true; key: string; id: string; url: string }> {
	const config = await loadJiraConfig();
	const JIRA_URL = config.jiraUrl;
	const auth = getAuthHeader(config.username, config.apiToken);
	const description = buildIssueDescription(input);

	const payload = {
		fields: {
			project: {
				key: input.board,
			},
			summary: input.title,
			description,
			issuetype: {
				name: input.issueType || 'Task',
			},
		},
	};

	const response = await fetch(`${JIRA_URL}/rest/api/3/issue`, {
		method: 'POST',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errorText = await response.text();
		let errorMessage = `Jira API error: ${response.status} ${response.statusText}`;

		try {
			const errorJson = JSON.parse(errorText);
			if (errorJson.errorMessages?.length > 0) {
				errorMessage += ` - ${errorJson.errorMessages.join(', ')}`;
			}
			if (errorJson.errors) {
				const fieldErrors = Object.entries(errorJson.errors)
					.map(([field, msg]) => `${field}: ${msg}`)
					.join(', ');
				if (fieldErrors) {
					errorMessage += ` - ${fieldErrors}`;
				}
			}
		} catch {
			errorMessage += ` - ${errorText}`;
		}

		throw new Error(errorMessage);
	}

	const result = (await response.json()) as JiraCreateResponse;
	const issueKey = result.key;

	// Post-creation: handle attachments, assignee, sprint
	const hasAttachments = input.attachments && input.attachments.length > 0;

	if (hasAttachments) {
		const uploadedFilenames = await uploadAttachments(
			issueKey,
			input.attachments!,
			JIRA_URL,
			auth,
		);

		// Re-write description using wiki markup to embed images inline
		if (uploadedFilenames.length > 0) {
			await updateDescriptionWithWikiMarkup(
				issueKey,
				input,
				uploadedFilenames,
				JIRA_URL,
				auth,
			);
		}
	}

	if (input.assignee) {
		const accountId = await resolveAssigneeAccountId(
			input.assignee,
			JIRA_URL,
			auth,
		);
		await assignIssue(issueKey, accountId, JIRA_URL, auth);
	}

	if (input.sprint != null) {
		const sprintId = await resolveSprintId(
			input.sprint,
			input.board,
			JIRA_URL,
			auth,
		);
		await moveIssueToSprint(issueKey, sprintId, JIRA_URL, auth);
	}

	return {
		success: true,
		key: result.key,
		id: result.id,
		url: `${JIRA_URL}/browse/${result.key}`,
	};
}

async function updateIssue(
	issueKey: string,
	input: IssueInput,
): Promise<{ success: true; key: string; url: string }> {
	const config = await loadJiraConfig();
	const JIRA_URL = config.jiraUrl;
	const auth = getAuthHeader(config.username, config.apiToken);

	const hasAttachments = input.attachments && input.attachments.length > 0;
	let uploadedFilenames: string[] = [];

	if (hasAttachments) {
		uploadedFilenames = await uploadAttachments(
			issueKey,
			input.attachments!,
			JIRA_URL,
			auth,
		);
	}

	// If we have attachments, use wiki markup to embed them inline
	if (uploadedFilenames.length > 0) {
		await updateDescriptionWithWikiMarkup(
			issueKey,
			input,
			uploadedFilenames,
			JIRA_URL,
			auth,
		);
	} else {
		// No attachments — use ADF (v3 API)
		const description = buildIssueDescription(input);
		const payload = { fields: { description } };

		const response = await fetch(`${JIRA_URL}/rest/api/3/issue/${issueKey}`, {
			method: 'PUT',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `Jira API error: ${response.status} ${response.statusText}`;

			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.errorMessages?.length > 0) {
					errorMessage += ` - ${errorJson.errorMessages.join(', ')}`;
				}
				if (errorJson.errors) {
					const fieldErrors = Object.entries(errorJson.errors)
						.map(([field, msg]) => `${field}: ${msg}`)
						.join(', ');
					if (fieldErrors) {
						errorMessage += ` - ${fieldErrors}`;
					}
				}
			} catch {
				errorMessage += ` - ${errorText}`;
			}

			throw new Error(errorMessage);
		}
	}

	// Handle assignee and sprint on update too
	if (input.assignee) {
		const accountId = await resolveAssigneeAccountId(
			input.assignee,
			JIRA_URL,
			auth,
		);
		await assignIssue(issueKey, accountId, JIRA_URL, auth);
	}

	if (input.sprint != null) {
		const sprintId = await resolveSprintId(
			input.sprint,
			input.board,
			JIRA_URL,
			auth,
		);
		await moveIssueToSprint(issueKey, sprintId, JIRA_URL, auth);
	}

	return {
		success: true,
		key: issueKey,
		url: `${JIRA_URL}/browse/${issueKey}`,
	};
}

async function main(): Promise<void> {
	try {
		const args = process.argv.slice(2);

		if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
			console.log(`
Create/Update Jira Issue (EN/AW boards)

Usage:
  # Create via stdin (recommended):
  echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["..."], "issueType": "Task"}' | bun create-issue.ts --stdin

  # Update via stdin:
  echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["..."], "issueKey": "EN-1234"}' | bun create-issue.ts --stdin --update

  # Create via arguments:
  bun create-issue.ts --board "EN" --title "..." --context "..." --definitionOfDone "..." [--issueType "Task"]

  # Update via arguments:
  bun create-issue.ts --update --issueKey "EN-1234" --board "EN" --title "..." --context "..." --definitionOfDone "..."

Required fields:
  --board             Board to create issue on (EN or AW)
  --title             Short, descriptive title
  --context           Background information explaining the issue
  --definitionOfDone  Criteria for completion (can be specified multiple times)

Optional fields:
  --issueType         Type of issue: Task (default), Bug, or Story
  --assignee          Assignee display name or email (resolved via search)
  --sprint            Sprint name (partial match) or numeric sprint ID
  --attachment        File path to attach (can be specified multiple times)
  --update            Update an existing issue instead of creating
  --issueKey          Issue key to update (required with --update)

Credentials:
  Reads from env vars (JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN)
  or ~/.config/atlassian-jira/credentials.json
`);
			process.exit(0);
		}

		const isUpdate = args.includes('--update');
		let issueKey: string | undefined;

		// Extract issueKey from args or stdin
		const issueKeyIndex = args.indexOf('--issueKey');
		if (issueKeyIndex !== -1 && args[issueKeyIndex + 1]) {
			issueKey = args[issueKeyIndex + 1];
		}

		let input: IssueInput;

		const parsed = parseArgs(args);
		if (parsed === 'stdin') {
			const stdinData = await readStdin();
			const jsonInput = JSON.parse(stdinData);
			if (isUpdate && jsonInput.issueKey) {
				issueKey = jsonInput.issueKey;
			}
			input = validateInput(jsonInput);
		} else {
			input = parsed;
		}

		if (isUpdate) {
			if (!issueKey) {
				throw new Error('--issueKey is required when using --update');
			}
			const result = await updateIssue(issueKey, input);
			console.log(JSON.stringify(result, null, 2));
		} else {
			const result = await createIssue(input);
			console.log(JSON.stringify(result, null, 2));
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(
			JSON.stringify(
				{
					success: false,
					error: errorMessage,
				},
				null,
				2,
			),
		);
		process.exit(1);
	}
}

main();
