import { describe, expect, test } from 'bun:test';
import { renderAdf, type AdfNode } from './adf';
import { generateIssueMarkdown } from './fetch-issue';

const text = (value: string): AdfNode => ({ type: 'text', text: value });
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });
const task = (value: string, state = 'TODO'): AdfNode => ({
	type: 'taskItem', attrs: { state }, content: [text(value)],
});
const requirement = 'In Model column, remove “0.3.0”. Just saying OpenFold will be enough on this page.';

// Mirrors FR-891: taskList can itself contain taskList nodes as siblings of tasks.
const checklist: AdfNode = {
	type: 'taskList', content: [
		task('Jobs table:'),
		{ type: 'taskList', content: [task(requirement), task('Completed task', 'DONE')] },
	],
};

describe('ADF rendering', () => {
	test('preserves inline checklist text, nested sibling lists and completion state', () => {
		expect(renderAdf([checklist])).toBe(
			`- [ ] Jobs table:\n  - [ ] ${requirement}\n  - [x] Completed task`,
		);
	});

	test('renders formatting, links, mentions, emoji and line breaks in tasks', () => {
		expect(renderAdf([{
			type: 'taskList', content: [{ type: 'taskItem', content: [
				{ ...text('old'), marks: [{ type: 'strike' }] }, text(' '),
				{ ...text('new'), marks: [{ type: 'strong' }] }, text(' '),
				{ ...text('spec'), marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
				{ type: 'hardBreak' }, { type: 'mention', attrs: { text: 'Alice' } },
				{ type: 'emoji', attrs: { shortName: ':check_mark:' } },
			] }],
		}])).toBe('- [ ] ~~old~~ **new** [spec](https://example.com)\n      @Alice:check_mark:');
	});

	test('preserves paragraph-wrapped tasks and mixed nested lists', () => {
		expect(renderAdf([{
			type: 'bulletList', content: [{ type: 'listItem', content: [
				paragraph(text('Parent')),
				{ type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [
					paragraph(text('Child')),
					{ type: 'orderedList', attrs: { order: 3 }, content: [
						{ type: 'listItem', content: [paragraph(text('Third'))] },
					] },
				] }] },
			] }],
		}])).toBe('- Parent\n  - [x] Child\n        3. Third');
	});

	test('retains text inside unknown containers', () => {
		expect(renderAdf([{ type: 'futurePanel', content: [checklist] }])).toContain(requirement);
		expect(renderAdf([{ type: 'futureInline', content: [text('Still here')] }])).toBe('Still here');
	});

	test('retains legacy expand, table, card and media rendering', () => {
		const rendered = renderAdf([
			{ type: 'expand', attrs: { title: 'Details' }, content: [paragraph(text('Expanded'))] },
			{ type: 'table', content: [
				{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph(text('Header'))] }] },
				{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('a|b'))] }] },
			] },
			{ type: 'blockCard', attrs: { url: 'https://example.com/card' } },
			{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'mapped' } }] },
			{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'unmapped', alt: 'screenshot.png' } }] },
		], { mapped: 'diagram.png' });
		expect(rendered).toContain('<summary>Details</summary>\n\nExpanded');
		expect(rendered).toContain('| Header |\n| --- |\n| a\\|b |');
		expect(rendered).toContain('https://example.com/card');
		expect(rendered).toContain('@diagram.png');
		expect(rendered).toContain('@screenshot.png');
	});

	test('retains headings, code, quotes, regular lists and inline cards', () => {
		expect(renderAdf([
			{ type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
			{ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;')] },
			{ type: 'blockquote', content: [paragraph(text('Quoted'))] },
			{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('Bullet'))] }] },
			paragraph({ type: 'inlineCard', attrs: { url: 'https://example.com' } }),
			{ type: 'rule' },
		])).toBe('## Title\n\n```ts\nconst x = 1;\n```\n\n> Quoted\n\n- Bullet\n\nhttps://example.com\n\n---');
	});

	test('uses the converter for both issue descriptions and comments', () => {
		const rendered = generateIssueMarkdown({
			id: '1', key: 'TEST-1', fields: {
				summary: 'Checklist regression', description: { content: [checklist] },
				status: { name: 'Open' }, issuetype: { name: 'Task' },
				created: '2026-01-01', updated: '2026-01-01',
			},
		}, [{
			id: '2', author: { displayName: 'Reviewer' }, body: { content: [checklist] },
			created: '2026-01-01', updated: '2026-01-01',
		}]);
		expect(rendered.split(requirement)).toHaveLength(3);
		expect(rendered).toContain('## Discussion (1 comment)');
	});

	test('handles missing content', () => {
		expect(renderAdf()).toBe('');
		expect(renderAdf([{ type: 'taskList' }])).toBe('');
	});
});
