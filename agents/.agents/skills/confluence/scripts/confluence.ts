/**
 * Shared Confluence helpers: config/auth, REST API, and markdown <-> storage
 * format conversion.
 *
 * Auth resolution order (first complete set wins):
 *   1. JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN   (one Atlassian Cloud token
 *      works for both Jira and Confluence; matches the rest of this repo)
 *   2. CONFLUENCE_URL / CONFLUENCE_USERNAME / CONFLUENCE_API_TOKEN
 *
 * The Confluence Cloud REST base is `<site>/wiki/rest/api`. We normalise any
 * trailing `/wiki` off the configured URL so both env styles work.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

// ── Config / auth ───────────────────────────────────────────────────────────

export interface ConfluenceConfig {
	/** Site root without trailing /wiki, e.g. https://apheris.atlassian.net */
	site: string;
	/** REST base, e.g. https://apheris.atlassian.net/wiki/rest/api */
	apiBase: string;
	/** Web base for browser links, e.g. https://apheris.atlassian.net/wiki */
	webBase: string;
	headers: Record<string, string>;
}

export function loadConfig(): ConfluenceConfig {
	const url = process.env.JIRA_URL ?? process.env.CONFLUENCE_URL;
	const username = process.env.JIRA_USERNAME ?? process.env.CONFLUENCE_USERNAME;
	const token = process.env.JIRA_API_TOKEN ?? process.env.CONFLUENCE_API_TOKEN;

	if (!url || !username || !token) {
		console.error("Missing Confluence credentials. Set either:");
		console.error("  JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN");
		console.error("  or CONFLUENCE_URL, CONFLUENCE_USERNAME, CONFLUENCE_API_TOKEN");
		console.error("Generate a token at https://id.atlassian.com/manage-profile/security/api-tokens");
		process.exit(1);
	}

	const site = url.replace(/\/wiki\/?$/, "").replace(/\/$/, "");
	const auth = Buffer.from(`${username}:${token}`).toString("base64");
	return {
		site,
		apiBase: `${site}/wiki/rest/api`,
		webBase: `${site}/wiki`,
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
	};
}

// ── REST API ──────────────────────────────────────────────────────────────────

export interface SearchHit {
	id: string;
	title: string;
	type: string;
	space?: string;
	url: string;
	lastModified?: string;
	excerpt?: string;
}

/** Search content via CQL. Returns normalised hits. */
export async function search(
	cfg: ConfluenceConfig,
	cql: string,
	limit = 25,
): Promise<SearchHit[]> {
	const url = `${cfg.apiBase}/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.version`;
	const res = await fetch(url, { headers: cfg.headers });
	if (!res.ok) {
		throw new Error(`Search failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
	}
	const data = (await res.json()) as {
		results: Array<{
			content?: {
				id: string;
				type: string;
				title: string;
				space?: { key: string };
				version?: { when: string };
				_links?: { webui?: string };
			};
			title?: string;
			excerpt?: string;
			url?: string;
		}>;
	};
	return data.results
		.filter((r) => r.content)
		.map((r) => {
			const c = r.content!;
			return {
				id: c.id,
				title: c.title,
				type: c.type,
				space: c.space?.key,
				url: c._links?.webui ? `${cfg.webBase}${c._links.webui}` : `${cfg.webBase}/spaces`,
				lastModified: c.version?.when,
				excerpt: r.excerpt?.replace(/@@@(hl|endhl)@@@/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined,
			};
		});
}

export interface Page {
	id: string;
	title: string;
	spaceKey: string;
	version: number;
	storage: string;
	ancestors: string[];
	url: string;
}

export async function getPage(cfg: ConfluenceConfig, id: string): Promise<Page> {
	const url = `${cfg.apiBase}/content/${id}?expand=body.storage,version,space,ancestors`;
	const res = await fetch(url, { headers: cfg.headers });
	if (!res.ok) {
		throw new Error(`Get page ${id} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
	}
	const d = (await res.json()) as any;
	return {
		id: d.id,
		title: d.title,
		spaceKey: d.space?.key,
		version: d.version?.number ?? 1,
		storage: d.body?.storage?.value ?? "",
		ancestors: (d.ancestors ?? []).map((a: any) => a.id),
		url: `${cfg.webBase}${d._links?.webui ?? ""}`,
	};
}

export async function findPageByTitle(
	cfg: ConfluenceConfig,
	spaceKey: string,
	title: string,
): Promise<{ id: string; version: number } | null> {
	const url =
		`${cfg.apiBase}/content?type=page&spaceKey=${encodeURIComponent(spaceKey)}` +
		`&title=${encodeURIComponent(title)}&expand=version`;
	const res = await fetch(url, { headers: cfg.headers });
	if (!res.ok) return null;
	const data = (await res.json()) as { results: Array<{ id: string; version: { number: number } }> };
	if (data.results?.length) return { id: data.results[0].id, version: data.results[0].version.number };
	return null;
}

/** Resolve a page id from an id, a Confluence URL, or a title (+space). */
export async function resolvePageId(
	cfg: ConfluenceConfig,
	opts: { id?: string; url?: string; title?: string; space?: string },
): Promise<string> {
	if (opts.id) return opts.id;
	if (opts.url) {
		const m = opts.url.match(/\/pages\/(\d+)/);
		if (m) return m[1];
		throw new Error(`Could not extract a page id from URL: ${opts.url}`);
	}
	if (opts.title && opts.space) {
		const found = await findPageByTitle(cfg, opts.space, opts.title);
		if (!found) throw new Error(`No page titled "${opts.title}" in space ${opts.space}`);
		return found.id;
	}
	throw new Error("Provide one of: --id, --url, or --title with --space");
}

export interface UpsertResult {
	id: string;
	title: string;
	version: number;
	url: string;
}

export async function createOrUpdatePage(
	cfg: ConfluenceConfig,
	opts: { id?: string; spaceKey: string; parentId?: string; title: string; storage: string },
): Promise<UpsertResult> {
	let existing: { id: string; version: number } | null = null;
	if (opts.id) {
		const p = await getPage(cfg, opts.id);
		existing = { id: p.id, version: p.version };
	} else {
		existing = await findPageByTitle(cfg, opts.spaceKey, opts.title);
	}

	const ancestors = opts.parentId ? [{ id: opts.parentId }] : undefined;

	if (existing) {
		const body: any = {
			id: existing.id,
			type: "page",
			title: opts.title,
			space: { key: opts.spaceKey },
			version: { number: existing.version + 1 },
			body: { storage: { value: opts.storage, representation: "storage" } },
		};
		if (ancestors) body.ancestors = ancestors;
		const res = await fetch(`${cfg.apiBase}/content/${existing.id}`, {
			method: "PUT",
			headers: cfg.headers,
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Update failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
		const d = (await res.json()) as any;
		return { id: d.id, title: d.title, version: d.version.number, url: `${cfg.webBase}${d._links.webui}` };
	}

	const body: any = {
		type: "page",
		title: opts.title,
		space: { key: opts.spaceKey },
		body: { storage: { value: opts.storage, representation: "storage" } },
	};
	if (ancestors) body.ancestors = ancestors;
	const res = await fetch(`${cfg.apiBase}/content`, {
		method: "POST",
		headers: cfg.headers,
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Create failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
	const d = (await res.json()) as any;
	return { id: d.id, title: d.title, version: d.version.number, url: `${cfg.webBase}${d._links.webui}` };
}

async function getExistingAttachments(cfg: ConfluenceConfig, pageId: string): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	let start = 0;
	const limit = 100;
	while (true) {
		const res = await fetch(
			`${cfg.apiBase}/content/${pageId}/child/attachment?limit=${limit}&start=${start}`,
			{ headers: cfg.headers },
		);
		if (!res.ok) break;
		const data = (await res.json()) as { results: Array<{ id: string; title: string }> };
		for (const a of data.results) map.set(a.title, a.id);
		if (data.results.length < limit) break;
		start += limit;
	}
	return map;
}

export async function uploadAttachments(
	cfg: ConfluenceConfig,
	pageId: string,
	files: Set<string>,
): Promise<{ uploaded: number; failed: number }> {
	if (files.size === 0) return { uploaded: 0, failed: 0 };
	const existing = await getExistingAttachments(cfg, pageId);
	let uploaded = 0;
	let failed = 0;
	for (const filePath of files) {
		const filename = basename(filePath);
		try {
			const data = await readFile(filePath);
			const form = new FormData();
			form.append("file", new Blob([data]), filename);
			form.append("minorEdit", "true");
			form.append("comment", "Uploaded by confluence skill");
			const id = existing.get(filename);
			const url = id
				? `${cfg.apiBase}/content/${pageId}/child/attachment/${id}/data`
				: `${cfg.apiBase}/content/${pageId}/child/attachment`;
			const res = await fetch(url, {
				method: "POST",
				headers: { Authorization: cfg.headers.Authorization, Accept: "application/json", "X-Atlassian-Token": "no-check" },
				body: form,
			});
			if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 150)}`);
			uploaded++;
		} catch (err) {
			console.error(`  failed to upload ${filename}: ${(err as Error).message}`);
			failed++;
		}
	}
	return { uploaded, failed };
}

// ── Frontmatter (for round-tripping read -> edit -> write) ────────────────────

export interface Frontmatter {
	confluenceId?: string;
	title?: string;
	space?: string;
	parentId?: string;
	url?: string;
	version?: number;
}

export function parseFrontmatter(md: string): { meta: Frontmatter; body: string } {
	const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!m) return { meta: {}, body: md };
	const meta: Frontmatter = {};
	for (const line of m[1].split("\n")) {
		const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1];
		const val = kv[2].trim().replace(/^["']|["']$/g, "");
		if (key === "confluenceId") meta.confluenceId = val;
		else if (key === "title") meta.title = val;
		else if (key === "space") meta.space = val;
		else if (key === "parentId") meta.parentId = val;
		else if (key === "url") meta.url = val;
		else if (key === "version") meta.version = Number(val);
	}
	return { meta, body: md.slice(m[0].length) };
}

export function buildFrontmatter(meta: Frontmatter): string {
	const lines = ["---"];
	if (meta.confluenceId) lines.push(`confluenceId: ${meta.confluenceId}`);
	if (meta.title) lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
	if (meta.space) lines.push(`space: ${meta.space}`);
	if (meta.parentId) lines.push(`parentId: ${meta.parentId}`);
	if (meta.version !== undefined) lines.push(`version: ${meta.version}`);
	if (meta.url) lines.push(`url: ${meta.url}`);
	lines.push("---", "");
	return lines.join("\n");
}

// ── HTML entity helpers ──────────────────────────────────────────────────────

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&mdash;/g, "—")
		.replace(/&ndash;/g, "–")
		.replace(/&hellip;/g, "…")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Markdown -> Confluence storage format ─────────────────────────────────────

/**
 * Converts a practical subset of Markdown to Confluence storage format.
 * Local image/video paths are collected in `localMedia` (absolute paths) so the
 * caller can upload them as page attachments.
 */
export function markdownToStorage(md: string, markdownDir: string): { storage: string; localMedia: Set<string> } {
	const localMedia = new Set<string>();
	const lines = md.split("\n");
	const out: string[] = [];
	let inList = false;
	let listType: "ul" | "ol" = "ul";
	let inCode = false;
	let codeLang = "";
	let codeLines: string[] = [];
	let tableRows: string[][] = [];
	let tableHasHeader = false;
	let paraLines: string[] = [];

	const closeList = () => {
		if (inList) {
			out.push(listType === "ul" ? "</ul>" : "</ol>");
			inList = false;
		}
	};

	const flushTable = () => {
		if (tableRows.length === 0) return;
		const rows = tableRows;
		out.push("<table><tbody>");
		rows.forEach((cells, i) => {
			const tag = tableHasHeader && i === 0 ? "th" : "td";
			out.push("<tr>" + cells.map((c) => `<${tag}><p>${inlineMd(c.trim())}</p></${tag}>`).join("") + "</tr>");
		});
		out.push("</tbody></table>");
		tableRows = [];
		tableHasHeader = false;
	};

	// Join consecutive (soft-wrapped) text lines into a single paragraph, the way
	// standard Markdown does — this avoids spurious line breaks inside paragraphs.
	const flushPara = () => {
		if (paraLines.length === 0) return;
		out.push(`<p>${inlineMd(paraLines.join(" "))}</p>`);
		paraLines = [];
	};

	const resolveMedia = (src: string): string => {
		const abs = resolve(markdownDir, src);
		const rel = relative(markdownDir, abs);
		if (!rel.startsWith("..") && !isAbsolute(rel) && existsSync(abs)) localMedia.add(abs);
		return basename(src);
	};

	const renderImage = (alt: string, src: string): string => {
		if (/^https?:/.test(src)) return `<ac:image ac:width="600"><ri:url ri:value="${src}" /></ac:image>`;
		return `<ac:image ac:width="600" ac:alt="${escapeXml(alt)}"><ri:attachment ri:filename="${resolveMedia(src)}" /></ac:image>`;
	};

	const inlineMd = (text: string): string => {
		text = escapeXml(text);
		text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => renderImage(alt, decodeEntities(src)));
		text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${decodeEntities(href)}">${t}</a>`);
		text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
		text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>");
		text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");
		text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
		return text;
	};

	for (const raw of lines) {
		const fence = raw.match(/^```(\w*)\s*$/);
		if (fence) {
			if (!inCode) {
				flushPara();
				closeList();
				flushTable();
				inCode = true;
				codeLang = fence[1] || "none";
				codeLines = [];
			} else {
				inCode = false;
				out.push(
					`<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${codeLang}</ac:parameter>` +
						`<ac:plain-text-body><![CDATA[${codeLines.join("\n").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></ac:plain-text-body></ac:structured-macro>`,
				);
			}
			continue;
		}
		if (inCode) {
			codeLines.push(raw);
			continue;
		}

		// Table row
		const isTableRow = /^\s*\|.*\|\s*$/.test(raw);
		const isTableSep = /^\s*\|?[\s:|-]+\|?\s*$/.test(raw) && raw.includes("-");
		if (isTableRow || (tableRows.length > 0 && isTableSep)) {
			flushPara();
			closeList();
			if (isTableSep && tableRows.length === 1) {
				tableHasHeader = true;
				continue;
			}
			const cells = raw.trim().replace(/^\||\|$/g, "").split("|");
			tableRows.push(cells);
			continue;
		}
		flushTable();

		if (/^---+$/.test(raw.trim())) {
			flushPara();
			closeList();
			out.push("<hr />");
			continue;
		}
		const h = raw.match(/^(#{1,6})\s+(.+)$/);
		if (h) {
			flushPara();
			closeList();
			out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
			continue;
		}
		const img = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
		if (img) {
			flushPara();
			closeList();
			out.push(`<p>${renderImage(img[1], img[2])}</p>`);
			continue;
		}
		const ol = raw.match(/^\s*\d+\.\s+(.+)$/);
		const ul = raw.match(/^\s*[-*]\s+(.+)$/);
		if (ol || ul) {
			flushPara();
			const kind: "ul" | "ol" = ol ? "ol" : "ul";
			if (inList && listType !== kind) closeList();
			if (!inList) {
				out.push(kind === "ul" ? "<ul>" : "<ol>");
				inList = true;
				listType = kind;
			}
			out.push(`<li>${inlineMd(ol ? ol[1] : ul![1])}</li>`);
			continue;
		}
		if (raw.trim() === "") {
			flushPara();
			closeList();
			out.push("");
			continue;
		}
		const bq = raw.match(/^>\s?(.*)$/);
		if (bq) {
			flushPara();
			closeList();
			out.push(`<blockquote><p>${inlineMd(bq[1])}</p></blockquote>`);
			continue;
		}
		// Plain text line: accumulate into the current paragraph buffer
		// (consecutive lines join into one paragraph on flush).
		closeList();
		paraLines.push(raw);
	}
	flushPara();
	closeList();
	flushTable();
	if (inCode) out.push(`<pre>${escapeXml(codeLines.join("\n"))}</pre>`);
	return { storage: out.join("\n"), localMedia };
}

// ── Confluence storage format -> Markdown ─────────────────────────────────────

/** Best-effort conversion of Confluence storage XHTML to Markdown. */
export function storageToMarkdown(html: string): string {
	let s = html.replace(/\r/g, "");

	// Protect fenced code blocks from code macros.
	const codeBlocks: string[] = [];
	s = s.replace(
		/<ac:structured-macro[^>]*ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
		(_m, inner) => {
			const lang = (inner.match(/ac:name="language">([^<]*)</) || [, ""])[1] || "";
			const body = (inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || [, ""])[1];
			codeBlocks.push("```" + (lang && lang !== "none" ? lang : "") + "\n" + body + "\n```");
			return `\u0000CODE${codeBlocks.length - 1}\u0000`;
		},
	);

	// Panels (info/note/warning/tip) -> blockquote.
	s = s.replace(
		/<ac:structured-macro[^>]*ac:name="(info|note|warning|tip)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
		(_m, _name, inner) => {
			const body = (inner.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/) || [, inner])[1];
			return `\n<blockquote>${body}</blockquote>\n`;
		},
	);

	// Images.
	s = s.replace(/<ac:image[^>]*>([\s\S]*?)<\/ac:image>/g, (_m, inner) => {
		const att = inner.match(/ri:filename="([^"]+)"/);
		const url = inner.match(/ri:value="([^"]+)"/);
		const src = att ? att[1] : url ? url[1] : "";
		return `\n![](${src})\n`;
	});

	// Tables -> GFM.
	s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_m, inner) => {
		const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
			[...r[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => inlineToMd(c[2]).replace(/\n/g, " ").trim()),
		);
		if (rows.length === 0) return "";
		const width = Math.max(...rows.map((r) => r.length));
		const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
		const md = [
			"| " + pad(rows[0]).join(" | ") + " |",
			"| " + Array(width).fill("---").join(" | ") + " |",
			...rows.slice(1).map((r) => "| " + pad(r).join(" | ") + " |"),
		];
		return "\n" + md.join("\n") + "\n";
	});

	// Block elements.
	s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_m, lvl, t) => `\n${"#".repeat(Number(lvl))} ${inlineToMd(t)}\n`);
	s = s.replace(/<hr[^>]*\/?>/g, "\n---\n");

	// Lists (handles one level of nesting reasonably).
	const renderList = (content: string, ordered: boolean, depth: number): string => {
		const indent = "  ".repeat(depth);
		let idx = 0;
		return [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
			.map((li) => {
				let item = li[1];
				let nested = "";
				item = item.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/g, (_m, tag, inner) => {
					nested = "\n" + renderList(inner, tag === "ol", depth + 1);
					return "";
				});
				const marker = ordered ? `${++idx}.` : "-";
				return `${indent}${marker} ${inlineToMd(item).trim()}${nested}`;
			})
			.join("\n");
	};
	// Repeatedly resolve top-level lists.
	let prev = "";
	while (prev !== s) {
		prev = s;
		s = s.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/g, (_m, tag, inner) => {
			if (/<(ul|ol)[^>]*>/.test(inner.replace(/<li[^>]*>[\s\S]*?<\/li>/g, (li) => li))) {
				// inner may still contain nested lists handled by renderList
			}
			return "\n" + renderList(inner, tag === "ol", 0) + "\n";
		});
	}

	s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, (_m, inner) =>
		"\n" + inlineToMd(inner).trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n",
	);
	s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_m, t) => `\n${inlineToMd(t)}\n`);

	// Restore code blocks.
	s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => "\n" + codeBlocks[Number(i)] + "\n");

	// Strip leftover tags, decode entities, collapse blank lines.
	s = s.replace(/<[^>]+>/g, "");
	s = decodeEntities(s);
	s = s.replace(/\n{3,}/g, "\n\n").trim();
	return s + "\n";
}

function inlineToMd(html: string): string {
	let s = html;
	s = s.replace(/<br\s*\/?>/g, "  \n");
	s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, "**$1**");
	s = s.replace(/<b>([\s\S]*?)<\/b>/g, "**$1**");
	s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/g, "*$1*");
	s = s.replace(/<i>([\s\S]*?)<\/i>/g, "*$1*");
	s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, "`$1`");
	s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, "[$2]($1)");
	s = s.replace(/<ac:image[^>]*>([\s\S]*?)<\/ac:image>/g, (_m, inner) => {
		const att = inner.match(/ri:filename="([^"]+)"/);
		const url = inner.match(/ri:value="([^"]+)"/);
		return `![](${att ? att[1] : url ? url[1] : ""})`;
	});
	s = s.replace(/<[^>]+>/g, "");
	return decodeEntities(s);
}
