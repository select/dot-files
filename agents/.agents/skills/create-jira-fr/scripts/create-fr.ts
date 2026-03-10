#!/usr/bin/env bun

/**
 * Create Jira Feature Request (FR) Script
 *
 * Creates a Feature Request on the FR board with proper Atlassian Document Format (ADF).
 *
 * Usage:
 *   # Via stdin (recommended for complex content):
 *   echo '{"title": "...", "description": "...", "useCase": "...", "expectedBehavior": ["..."], "additionalInfo": "..."}' | bun create-fr.ts --stdin
 *
 *   # Via command line arguments:
 *   bun create-fr.ts --title "..." --description "..." --useCase "..." --expectedBehavior "..." --additionalInfo "..."
 *
 * Environment variables required:
 *   - JIRA_URL: Jira instance URL (e.g., https://apheris.atlassian.net)
 *   - JIRA_USERNAME: Jira username/email
 *   - JIRA_API_TOKEN: Jira API token
 */

interface Footer {
	rfcDocument?: boolean;
	testingStrategy?: boolean;
	engineeringTasks?: boolean;
	documentationTasks?: boolean;
}

interface FRInput {
	title: string;
	description: string;
	useCase: string;
	expectedBehavior: string[];
	additionalInfo?: string;
	footer?: Footer;
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

function createHorizontalRule(): AdfNode {
	return { type: 'rule' };
}

function createEmojiNode(shortName: string): AdfNode {
	return {
		type: 'emoji',
		attrs: {
			shortName,
		},
	};
}

function createFooterChecklistItem(label: string, isLinked: boolean): AdfNode {
	const emoji = isLinked
		? createEmojiNode(':white_check_mark:')
		: createEmojiNode(':x:');

	return createParagraph(emoji, createTextNode(` ${label}`));
}

function buildFRDescription(input: FRInput): AdfDocument {
	const content: AdfNode[] = [];

	// Description section
	content.push(createHeading('Description', 2));
	content.push(createParagraph(createTextNode(input.description)));

	// Use Case section
	content.push(createHeading('Use Case', 2));
	content.push(createParagraph(createTextNode(input.useCase)));

	// Expected Behavior section
	content.push(createHeading('Expected Behavior', 2));
	if (input.expectedBehavior.length > 0) {
		content.push(createBulletList(input.expectedBehavior));
	}

	// Additional Information section (if provided)
	if (input.additionalInfo && input.additionalInfo.trim()) {
		content.push(createHeading('Additional Information', 2));
		content.push(createParagraph(createTextNode(input.additionalInfo)));
	}

	// Footer reminder with checklist
	const footer = input.footer ?? {};
	content.push(createHorizontalRule());
	content.push(
		createParagraph(
			createTextNode(
				'Ensure that tickets in JIRA were created (in the respective teams) and linked to this Feature Request, covering the following:',
				true,
			),
		),
	);
	content.push(
		createFooterChecklistItem('RFC Document', footer.rfcDocument ?? false),
	);
	content.push(
		createFooterChecklistItem(
			'Testing Strategy',
			footer.testingStrategy ?? false,
		),
	);
	content.push(
		createFooterChecklistItem(
			'Engineering tasks (covering dev, infra, quality)',
			footer.engineeringTasks ?? false,
		),
	);
	content.push(
		createFooterChecklistItem(
			'Documentation tasks',
			footer.documentationTasks ?? false,
		),
	);

	return {
		type: 'doc',
		version: 1,
		content,
	};
}

function validateInput(input: unknown): FRInput {
	if (!input || typeof input !== 'object') {
		throw new Error('Input must be a JSON object');
	}

	const obj = input as Record<string, unknown>;

	if (!obj.title || typeof obj.title !== 'string' || !obj.title.trim()) {
		throw new Error('title is required and must be a non-empty string');
	}

	if (
		!obj.description ||
		typeof obj.description !== 'string' ||
		!obj.description.trim()
	) {
		throw new Error('description is required and must be a non-empty string');
	}

	if (!obj.useCase || typeof obj.useCase !== 'string' || !obj.useCase.trim()) {
		throw new Error('useCase is required and must be a non-empty string');
	}

	if (!obj.expectedBehavior || !Array.isArray(obj.expectedBehavior)) {
		throw new Error(
			'expectedBehavior is required and must be an array of strings',
		);
	}

	const expectedBehavior = obj.expectedBehavior.filter(
		(item): item is string => typeof item === 'string' && item.trim() !== '',
	);

	if (expectedBehavior.length === 0) {
		throw new Error(
			'expectedBehavior must contain at least one non-empty string',
		);
	}

	// Parse footer if provided
	let footer: Footer | undefined;
	const footerSource = obj.footer;
	if (footerSource && typeof footerSource === 'object') {
		const ft = footerSource as Record<string, unknown>;
		footer = {
			rfcDocument: ft.rfcDocument === true,
			testingStrategy: ft.testingStrategy === true,
			engineeringTasks: ft.engineeringTasks === true,
			documentationTasks: ft.documentationTasks === true,
		};
	}

	return {
		title: obj.title.trim(),
		description: obj.description.trim(),
		useCase: obj.useCase.trim(),
		expectedBehavior,
		additionalInfo:
			typeof obj.additionalInfo === 'string'
				? obj.additionalInfo.trim()
				: undefined,
		footer,
	};
}

function parseArgs(args: string[]): FRInput | 'stdin' {
	if (args.includes('--stdin')) {
		return 'stdin';
	}

	const result: Partial<FRInput> & { footer?: Footer } = {
		expectedBehavior: [],
		footer: {},
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const nextArg = args[i + 1];

		switch (arg) {
			case '--title':
				result.title = nextArg;
				i++;
				break;
			case '--description':
				result.description = nextArg;
				i++;
				break;
			case '--useCase':
				result.useCase = nextArg;
				i++;
				break;
			case '--expectedBehavior':
				result.expectedBehavior!.push(nextArg!);
				i++;
				break;
		case '--additionalInfo':
			result.additionalInfo = nextArg;
			i++;
			break;
		case '--footer.rfcDocument':
			result.footer!.rfcDocument = nextArg === 'true';
			i++;
			break;
		case '--footer.testingStrategy':
			result.footer!.testingStrategy = nextArg === 'true';
			i++;
			break;
		case '--footer.engineeringTasks':
			result.footer!.engineeringTasks = nextArg === 'true';
			i++;
			break;
		case '--footer.documentationTasks':
			result.footer!.documentationTasks = nextArg === 'true';
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

async function createFR(
	input: FRInput,
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
	const description = buildFRDescription(input);

	const payload = {
		fields: {
			project: {
				key: 'FR',
			},
			summary: input.title,
			description,
			issuetype: {
				name: 'FEATURE REQUEST',
			},
			// Source - required field (Internal = 10046)
			customfield_10067: { id: '10046' },
			// Scope - required field (Hub = 10687)
			customfield_10182: { id: '10687' },
			// Customer Name(s) - required field (Internal = 10183)
			customfield_10107: [{ id: '10183' }],
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
Create Jira Feature Request (FR)

Usage:
  # Via stdin (recommended):
  echo '{"title": "...", "description": "...", "useCase": "...", "expectedBehavior": ["..."], "additionalInfo": "...", "footer": {...}}' | bun create-fr.ts --stdin

  # Via arguments:
  bun create-fr.ts --title "..." --description "..." --useCase "..." --expectedBehavior "..." [--additionalInfo "..."] [--footer.rfcDocument true] [--footer.testingStrategy true] [--footer.engineeringTasks true] [--footer.documentationTasks true]

Required fields:
  --title             Short, descriptive title
  --description       Brief explanation of the feature
  --useCase           "As a [role], I want to [action] so that [benefit]"
  --expectedBehavior  Expected behavior (can be specified multiple times)

Optional fields:
  --additionalInfo                Links, references, related tickets
  --footer.rfcDocument            true/false (default: false)
  --footer.testingStrategy        true/false (default: false)
  --footer.engineeringTasks       true/false (default: false)
  --footer.documentationTasks     true/false (default: false)

Environment variables:
  JIRA_URL            Jira instance URL
  JIRA_USERNAME       Jira username/email
  JIRA_API_TOKEN      Jira API token
`);
			process.exit(0);
		}

		let input: FRInput;

		const parsed = parseArgs(args);
		if (parsed === 'stdin') {
			const stdinData = await readStdin();
			const jsonInput = JSON.parse(stdinData);
			input = validateInput(jsonInput);
		} else {
			input = parsed;
		}

		const result = await createFR(input);
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
