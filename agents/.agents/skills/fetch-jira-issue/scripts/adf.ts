/** Render Jira's Atlassian Document Format without dropping unknown containers. */
export interface AdfNode {
	type: string;
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
	content?: AdfNode[];
}

export function renderAdf(
	content: AdfNode[] = [],
	mediaIdMap: Record<string, string> = {},
): string {
	function inline(node: AdfNode): string {
		if (node.type === 'text') {
			let text = node.text || '';
			for (const mark of node.marks || []) {
				if (mark.type === 'strong') text = `**${text}**`;
				if (mark.type === 'em') text = `*${text}*`;
				if (mark.type === 'code') text = `\`${text}\``;
				if (mark.type === 'strike') text = `~~${text}~~`;
				if (mark.type === 'link') text = `[${text}](${mark.attrs?.href || ''})`;
			}
			return text;
		}
		if (node.type === 'mention') return `@${node.attrs?.text || 'user'}`;
		if (node.type === 'emoji') return String(node.attrs?.text || node.attrs?.shortName || '');
		if (node.type === 'inlineCard') return String(node.attrs?.url || '');
		if (node.type === 'hardBreak') return '\n';
		return node.text || (node.content || []).map(inline).join('');
	}

	function isList(node: AdfNode): boolean {
		return ['bulletList', 'orderedList', 'taskList'].includes(node.type);
	}

	function list(node: AdfNode, indent = ''): string {
		const start = Number(node.attrs?.order) || 1;
		return (node.content || []).map((item, index) => {
			// Jira task lists can contain nested taskList siblings, not only taskItems.
			if (isList(item)) return list(item, indent + '  ');
			const prefix = item.type === 'taskItem'
				? `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}]`
				: node.type === 'orderedList' ? `${start + index}.` : '-';
			const children = item.content || [];
			// taskItem stores inline nodes directly; listItem normally wraps paragraphs.
			let body = '';
			let pending: AdfNode[] = [];
			function flush() {
				if (pending.length) body += pending.map(inline).join('');
				pending = [];
			}
			for (const child of children) {
				if (['text', 'mention', 'emoji', 'inlineCard', 'hardBreak'].includes(child.type)) {
					pending.push(child);
				} else {
					flush();
					if (body && !body.endsWith('\n')) body += '\n';
					body += block(child).trimEnd() + '\n';
				}
			}
			flush();
			const lines = body.trimEnd().split('\n');
			// Keep continuation blocks aligned with the item's content.
			const continuation = indent + ' '.repeat(prefix.length + 1);
			return `${indent}${prefix} ${lines[0]}\n` + lines.slice(1)
				.map(line => line ? `${continuation}${line}\n` : '\n').join('');
		}).join('');
	}

	function block(node: AdfNode): string {
		const children = node.content || [];
		if (isList(node)) return list(node) + '\n';
		if (node.type === 'paragraph') return children.map(inline).join('') + '\n\n';
		if (node.type === 'heading') {
			const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
			return `${'#'.repeat(level)} ${children.map(inline).join('')}\n\n`;
		}
		if (node.type === 'codeBlock') {
			const code = children.map(child => child.text || '').join('');
			return `\`\`\`${node.attrs?.language || ''}\n${code}\n\`\`\`\n\n`;
		}
		if (node.type === 'blockquote') {
			return children.map(block).join('').trimEnd().split('\n')
				.map(line => `> ${line}`).join('\n') + '\n\n';
		}
		if (node.type === 'rule') return '---\n\n';
		if (node.type === 'expand' || node.type === 'nestedExpand') {
			return `<details>\n<summary>${node.attrs?.title || 'Details'}</summary>\n\n${children.map(block).join('').trim()}\n\n</details>\n\n`;
		}
		if (node.type === 'blockCard') return `${node.attrs?.url || ''}\n\n`;
		if (node.type === 'media') {
			const filename = mediaIdMap[String(node.attrs?.id)] || node.attrs?.alt;
			if (filename) return `@${filename}\n\n`;
			if (node.attrs?.url) return `${node.attrs.url}\n\n`;
			return '📎 *(unresolved attached file)*\n\n';
		}
		if (node.type === 'table') {
			return children.map((row, index) => {
				const cells = (row.content || []).map(cell =>
					(cell.content || []).map(block).join('').trim()
						.replace(/\|/g, '\\|').replace(/\n+/g, '<br>'),
				);
				const line = `| ${cells.join(' | ')} |\n`;
				return index === 0 ? line + `| ${cells.map(() => '---').join(' | ')} |\n` : line;
			}).join('') + '\n';
		}
		// Panels, media groups, and future ADF wrappers must preserve their contents.
		if (children.length) return children.map(block).join('');
		return inline(node);
	}

	return content.map(block).join('').trim();
}
