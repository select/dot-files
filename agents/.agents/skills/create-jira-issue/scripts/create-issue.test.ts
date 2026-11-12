import { describe, expect, test } from 'bun:test';
import { buildIssueDescription, buildWikiMarkupDescription } from './create-issue';

const input = (context: string) => ({
	board: 'EN' as const,
	title: 'Formatting regression test',
	context,
	definitionOfDone: ['Keep **formatting** and `code`'],
});

describe('description headings', () => {
	for (let level = 1; level <= 6; level++) {
		const hashes = '#'.repeat(level);
		test(`renders level ${level} in ADF and attachment wiki descriptions`, () => {
			const value = input(`${hashes} Section ${level}`);
			const adf = buildIssueDescription(value);
			expect(adf.content[1]).toEqual({
				type: 'heading',
				attrs: { level },
				content: [{ type: 'text', text: `Section ${level}` }],
			});
			const wiki = buildWikiMarkupDescription(value, ['screenshot.png']);
			expect(wiki).toContain(`h${level}. Section ${level}`);
			expect(wiki).not.toMatch(/^#{1,6}\s/m);
			expect(wiki).toContain('!screenshot.png|width=600!');
		});
	}

	test('separates headings from adjacent paragraphs and supports closing hashes', () => {
		const value = input('Before\n## **Section** ##\nAfter');
		const adf = buildIssueDescription(value);
		expect(adf.content.slice(1, 4).map((node) => node.type)).toEqual([
			'paragraph', 'heading', 'paragraph',
		]);
		expect(adf.content[2]).toMatchObject({
			attrs: { level: 2 },
			content: [{ text: 'Section', marks: [{ type: 'strong' }] }],
		});
		expect(buildWikiMarkupDescription(value, [])).toContain('h2. *Section*');
	});

	test('does not interpret ordinary hashes as headings', () => {
		const value = input('C# and #tags\n##no-space\n####### too many');
		expect(buildIssueDescription(value).content[1]?.type).toBe('paragraph');
		expect(buildWikiMarkupDescription(value, [])).toContain(value.context);
	});
});

describe('existing shared-repository features', () => {
	test('defaults to EN for CLI and stdin inputs without a board', () => {
		for (const stdin of [false, true]) {
			const { board, ...withoutBoard } = input('## Scope');
			const result = Bun.spawnSync({
				cmd: [process.execPath, `${import.meta.dir}/create-issue.ts`, '--dry-run',
					...(stdin ? ['--stdin'] : ['--title', withoutBoard.title,
						'--context', withoutBoard.context, '--definitionOfDone', 'Verified'])],
				...(stdin ? { stdin: new TextEncoder().encode(JSON.stringify(withoutBoard)) } : {}),
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString()).content[1].type).toBe('heading');
		}
	});

	test('preserves checkbox states and footer formatting', () => {
		const value = {
			...input('## Scope'),
			definitionOfDone: ['[ ] Keep **formatting**', '[x] Keep `code`'],
			footer: '### Attribution\n[Agent](https://example.com)',
		};
		const adf = buildIssueDescription(value);
		expect(adf.content[3]).toMatchObject({
			type: 'taskList',
			content: [
				{ type: 'taskItem', attrs: { state: 'TODO' } },
				{ type: 'taskItem', attrs: { state: 'DONE' } },
			],
		});
		expect(adf.content[4]).toMatchObject({
			type: 'heading', attrs: { level: 3 },
		});
		const wiki = buildWikiMarkupDescription(value, []);
		expect(wiki).toContain('* Keep *formatting*\n* Keep {{code}}');
		expect(wiki).toContain('h3. Attribution\n[Agent|https://example.com]');
	});

	test('keeps the CLI dry-run working for both supported boards', () => {
		for (const board of ['EN', 'AW']) {
			const result = Bun.spawnSync({
				cmd: [process.execPath, `${import.meta.dir}/create-issue.ts`,
					'--dry-run', '--board', board, '--title', 'Rendering test',
					'--context', '## Scope', '--definitionOfDone', '[x] Verified'],
			});
			expect(result.exitCode).toBe(0);
			const adf = JSON.parse(result.stdout.toString());
			expect(adf.content[1]).toMatchObject({
				type: 'heading', attrs: { level: 2 },
			});
			expect(adf.content[3].content[0].attrs.state).toBe('DONE');
		}
	});
});

describe('code, lists and attachments', () => {
	test('keeps fenced code literal in both description formats', () => {
		const code = '## not a heading\n**not bold**\n`not inline code`\n1. not a list\n- not a bullet\n[label](https://example.com)\n![image](screenshot.png)';
		const value = input(`## Before\n\n\`\`\`markdown\n${code}\n\`\`\`\n\n### After`);
		expect(buildIssueDescription(value).content[2]).toEqual({
			type: 'codeBlock',
			attrs: { language: 'markdown' },
			content: [{ type: 'text', text: code }],
		});
		const wiki = buildWikiMarkupDescription(value, ['screenshot.png']);
		expect(wiki).toContain(`{code:language=markdown}\n${code}\n{code}`);
		expect(wiki).toContain('h2. Before');
		expect(wiki).toContain('h3. After');
	});

	test('supports multiple code fences, including fences without a language', () => {
		const value = input('```\n# literal\n```\n## Middle\n```json\n{"key":"**literal**"}\n```');
		const wiki = buildWikiMarkupDescription(value, []);
		expect(wiki).toContain('{code}\n# literal\n{code}');
		expect(wiki).toContain('h2. Middle');
		expect(wiki).toContain('{code:language=json}\n{"key":"**literal**"}\n{code}');
	});

	test('retains numbered lists, bullets, links and inline formatting', () => {
		const value = input('## Steps\n1. **First**\n2. `Second`\n\n- [Docs](https://example.com)');
		const adf = buildIssueDescription(value);
		expect(adf.content.slice(1, 4).map((node) => node.type)).toEqual([
			'heading', 'orderedList', 'bulletList',
		]);
		const wiki = buildWikiMarkupDescription(value, []);
		expect(wiki).toContain('h2. Steps\n# *First*\n# {{Second}}');
		expect(wiki).toContain('* [Docs|https://example.com]');
		expect(wiki).toContain('h2. Definition of Done\n\n* Keep *formatting* and {{code}}');
	});

	test('embeds referenced screenshots once and appends unreferenced screenshots', () => {
		const value = input('## Reference\n![Target](/tmp/target.png)');
		const wiki = buildWikiMarkupDescription(value, ['target.png', 'before.png']);
		expect(wiki.match(/!target\.png\|width=600!/g)).toHaveLength(1);
		expect(wiki.match(/!before\.png\|width=600!/g)).toHaveLength(1);
	});
});
