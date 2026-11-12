import { afterEach, describe, expect, test } from 'bun:test';
import { moveIssue, parseArgs } from './move-issue';

const config = {
	jiraUrl: 'https://jira.example.invalid',
	username: 'offline-test',
	apiToken: 'synthetic-token',
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const source = {
	id: '100', key: 'SOURCE-123',
	fields: { issuetype: { name: 'Bug' }, project: { key: 'SOURCE' } },
};
const moved = {
	...source, key: 'EN-456',
	fields: { issuetype: { name: 'Bug' }, project: { key: 'EN' } },
};
const project = {
	key: 'EN', id: '20',
	issueTypes: [
		{ id: '1', name: 'Bug', subtask: false },
		{ id: '2', name: 'Task', subtask: false },
	],
};

type Step = { path: string; method?: string; body?: unknown; status?: number };
function mockRequests(steps: Step[]) {
	const requests: { path: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (input, init) => {
		const url = new URL(String(input));
		expect(url.origin).toBe(config.jiraUrl);
		const step = steps[requests.length];
		expect(step).toBeDefined();
		expect(url.pathname + url.search).toBe(step!.path);
		expect(init?.method ?? 'GET').toBe(step!.method ?? 'GET');
		requests.push({ path: step!.path, init });
		return step!.status === 204
			? new Response(null, { status: 204 })
			: Response.json(step!.body, { status: step!.status ?? 200 });
	}) as typeof fetch;
	return requests;
}

const moveSteps = (task = { status: 'COMPLETE' } as Record<string, unknown>): Step[] => [
	{ path: '/rest/api/3/issue/SOURCE-123?fields=issuetype,project', body: source },
	{ path: '/rest/api/3/project/EN', body: project },
	{ path: '/rest/api/3/bulk/issues/move', method: 'POST', body: { taskId: 'task-1' } },
	{ path: '/rest/api/3/task/task-1', body: task },
];
const movedStep: Step = {
	path: '/rest/api/3/issue/100?fields=project,issuetype', body: moved,
};

describe('move arguments', () => {
	test('defaults to EN and accepts only EN as destination', () => {
		expect(parseArgs(['--issue', 'SOURCE-123']).board).toBe('EN');
		expect(() => parseArgs(['--issue', 'SOURCE-123', '--board', 'AW'])).toThrow('--board must be EN');
	});

	test('distinguishes sprint IDs, names and the current sprint', () => {
		for (const [value, expected] of [['123', 123], ['EN Sprint 123', 'EN Sprint 123'], ['current', 'current']] as const) {
			expect(parseArgs(['--issue', 'SOURCE-123', '--sprint', value]).sprint).toBe(expected);
		}
	});

	test('rejects invalid keys and unknown flags before calling Jira', () => {
		expect(() => parseArgs(['--issue', 'invalid'])).toThrow('--issue must be a Jira issue key');
		expect(() => parseArgs(['--issue', 'SOURCE-123', '--unknown'])).toThrow('Unknown argument');
	});
});

describe('mocked issue moves', () => {
	test('waits for completion, preserves the issue type and assigns the new key to the active sprint', async () => {
		const steps = moveSteps();
		steps[3] = { path: '/rest/api/3/task/task-1', body: { status: 'RUNNING' } };
		steps.push(
			{ path: '/rest/api/3/task/task-1', body: { status: 'COMPLETE' } },
			movedStep,
			{ path: '/rest/agile/1.0/board/22/sprint?state=active', body: { values: [{ id: 77, name: 'EN Sprint 123' }] } },
			{ path: '/rest/agile/1.0/sprint/77/issue', method: 'POST', status: 204 },
		);
		const requests = mockRequests(steps);
		const result = await moveIssue({ issueKey: 'SOURCE-123', board: 'EN', sprint: 'current' }, config);
		expect(result).toMatchObject({ success: true, oldKey: 'SOURCE-123', key: 'EN-456', sprintId: 77 });
		const payload = JSON.parse(String(requests[2]!.init!.body));
		expect(payload.sendBulkNotification).toBe(true);
		expect(payload.targetToSourcesMapping['EN,1'].issueIdsOrKeys).toEqual(['100']);
		expect(JSON.parse(String(requests.at(-1)!.init!.body))).toEqual({ issues: ['EN-456'] });
		expect(requests).toHaveLength(steps.length);
	});

	test('supports an explicit target type and does not add a sprint unless requested', async () => {
		const steps = [...moveSteps(), movedStep];
		const requests = mockRequests(steps);
		const result = await moveIssue({ issueKey: 'SOURCE-123', board: 'EN', issueType: 'Task' }, config);
		expect(result.key).toBe('EN-456');
		expect(result.sprintId).toBeUndefined();
		const payload = JSON.parse(String(requests[2]!.init!.body));
		expect(payload.targetToSourcesMapping['EN,2']).toBeDefined();
		expect(requests).toHaveLength(steps.length);
	});

	test('rejects an unavailable target type before submitting a move', async () => {
		const requests = mockRequests(moveSteps().slice(0, 2));
		await expect(moveIssue({ issueKey: 'SOURCE-123', board: 'EN', issueType: 'Story' }, config)).rejects.toThrow('Available: Bug, Task');
		expect(requests).toHaveLength(2);
	});

	for (const task of [
		{ status: 'FAILED' },
		{ status: 'CANCELLED' },
		{ status: 'COMPLETE', result: { failedIssues: { '100': 'Move rejected' } } },
	]) {
		test(`reports failed move tasks (${JSON.stringify(task)}) without assigning a sprint`, async () => {
			const steps = moveSteps(task);
			const requests = mockRequests(steps);
			await expect(moveIssue({ issueKey: 'SOURCE-123', board: 'EN', sprint: 'current' }, config)).rejects.toThrow('Jira move task');
			expect(requests).toHaveLength(steps.length);
		});
	}

	test('reports the new key and URL if sprint assignment fails after a successful move', async () => {
		const steps = [...moveSteps(), movedStep, {
			path: '/rest/agile/1.0/sprint/77/issue', method: 'POST',
			status: 403, body: { error: 'Sprint assignment denied' },
		}];
		const requests = mockRequests(steps);
		await expect(moveIssue({ issueKey: 'SOURCE-123', board: 'EN', sprint: 77 }, config)).rejects.toThrow(
			'Issue moved from SOURCE-123 to EN-456 (https://jira.example.invalid/browse/EN-456), but sprint assignment failed:',
		);
		expect(requests).toHaveLength(steps.length);
	});
});
