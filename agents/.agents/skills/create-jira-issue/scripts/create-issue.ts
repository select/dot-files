#!/usr/bin/env bun

/**
 * Create Jira Issue Script (EN/AW boards)
 *
 * Creates an issue on the EN (Engineering) or AW (Apheris Web) board with proper Atlassian Document Format (ADF).
 *
 * Usage:
 *   # Via stdin (recommended for complex content):
 *   echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["..."], "issueType": "Task"}' | bun create-issue.ts --stdin
 *
 *   # Via command line arguments:
 *   bun create-issue.ts --board "EN" --title "..." --context "..." --definitionOfDone "..." --issueType "Task"
 *
 * Environment variables required:
 *   - JIRA_URL: Jira instance URL (e.g., https://apheris.atlassian.net)
 *   - JIRA_USERNAME: Jira username/email
 *   - JIRA_API_TOKEN: Jira API token
 */

type Board = 'EN' | 'AW';
type IssueType = 'Task' | 'Bug' | 'Story';

interface IssueInput {
	board: Board;
	title: string;
	context: string;
	definitionOfDone: string[];
	issueType?: IssueType;
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

function createTextNode(text: string, bold = false): AdfNode {
	const node: AdfNode = { type: 'text', text };
	if (bold) {
		node.marks = [{ type: 'strong' }];
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
			content: [createParagraph(createTextNode(item))],
		})),
	};
}

function buildIssueDescription(input: IssueInput): AdfDocument {
	const content: AdfNode[] = [];

	// Context section
	content.push(createHeading('Context', 2));
	content.push(createParagraph(createTextNode(input.context)));

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

	return {
		board,
		title: obj.title.trim(),
		context: obj.context.trim(),
		definitionOfDone,
		issueType,
	};
}

function parseArgs(args: string[]): IssueInput | 'stdin' {
	if (args.includes('--stdin')) {
		return 'stdin';
	}

	const result: Partial<IssueInput> = {
		definitionOfDone: [],
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

async function createIssue(
	input: IssueInput,
): Promise<{ success: true; key: string; id: string; url: string }> {
	const JIRA_URL = process.env.JIRA_URL;
	const JIRA_USERNAME = process.env.JIRA_USERNAME;
	const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

	if (!JIRA_URL) {
		throw new Error('JIRA_URL environment variable is not set');
	}
	if (!JIRA_USERNAME) {
		throw new Error('JIRA_USERNAME environment variable is not set');
	}
	if (!JIRA_API_TOKEN) {
		throw new Error('JIRA_API_TOKEN environment variable is not set');
	}

	const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString(
		'base64',
	);
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
			Authorization: `Basic ${auth}`,
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

	return {
		success: true,
		key: result.key,
		id: result.id,
		url: `${JIRA_URL}/browse/${result.key}`,
	};
}

async function main(): Promise<void> {
	try {
		const args = process.argv.slice(2);

		if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
			console.log(`
Create Jira Issue (EN/AW boards)

Usage:
  # Via stdin (recommended):
  echo '{"board": "EN", "title": "...", "context": "...", "definitionOfDone": ["..."], "issueType": "Task"}' | bun create-issue.ts --stdin

  # Via arguments:
  bun create-issue.ts --board "EN" --title "..." --context "..." --definitionOfDone "..." [--issueType "Task"]

Required fields:
  --board             Board to create issue on (EN or AW)
  --title             Short, descriptive title
  --context           Background information explaining the issue
  --definitionOfDone  Criteria for completion (can be specified multiple times)

Optional fields:
  --issueType         Type of issue: Task (default), Bug, or Story

Environment variables:
  JIRA_URL            Jira instance URL
  JIRA_USERNAME       Jira username/email
  JIRA_API_TOKEN      Jira API token
`);
			process.exit(0);
		}

		let input: IssueInput;

		const parsed = parseArgs(args);
		if (parsed === 'stdin') {
			const stdinData = await readStdin();
			const jsonInput = JSON.parse(stdinData);
			input = validateInput(jsonInput);
		} else {
			input = parsed;
		}

		const result = await createIssue(input);
		console.log(JSON.stringify(result, null, 2));
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
