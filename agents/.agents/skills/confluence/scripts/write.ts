#!/usr/bin/env bun
/**
 * Write (create or update) a Confluence page from a Markdown file.
 *
 * The Markdown may start with a YAML frontmatter block (as produced by read.ts)
 * carrying confluenceId / title / space / parentId. CLI flags override it.
 *
 * Update an existing page (round-trip after read.ts + edits):
 *   bun write.ts --file ./page.md
 *   bun write.ts --file ./notes.md --id 123456789
 *
 * Create a new page:
 *   bun write.ts --file ./notes.md --title "My New Page" --space AP --parentId 123456
 *
 * Local images referenced in the Markdown are uploaded as page attachments.
 * Prints a JSON line { pageId, url, title, version } on success.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
	assessMarkdownRoundTripRisks,
	buildFrontmatter,
	createOrUpdatePage,
	findPageByTitle,
	getPage,
	loadConfig,
	markdownToStorage,
	parseFrontmatter,
	uploadAttachments,
} from "./confluence.ts";

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			file: { type: "string" },
			id: { type: "string" },
			title: { type: "string" },
			space: { type: "string" },
			parentId: { type: "string" },
			"write-back": { type: "boolean", default: false },
			"force-lossy": { type: "boolean", default: false },
		},
	});

	if (!values.file) {
		console.error('Usage: bun write.ts --file <md> [--id <pageId>] [--title "..." --space KEY] [--parentId <id>] [--force-lossy]');
		process.exit(1);
	}

	const raw = await readFile(values.file, "utf-8");
	const { meta, body } = parseFrontmatter(raw);

	const id = values.id ?? meta.confluenceId;
	const space = values.space ?? meta.space;
	const parentId = values.parentId ?? meta.parentId;
	// Prefer an explicit flag, then frontmatter, then the first H1 in the body.
	const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	const title = values.title ?? meta.title ?? h1;

	if (!id && (!title || !space)) {
		console.error("To create a page provide --title and --space (or frontmatter). To update, provide --id or a confluenceId in frontmatter.");
		process.exit(1);
	}

	// Drop a leading H1 that duplicates the page title (Confluence shows the title separately).
	const content = h1 && title === h1 ? body.replace(/^#\s+.+\n+/, "") : body;

	const cfg = loadConfig();
	let existingPage = id ? await getPage(cfg, id) : undefined;
	if (!existingPage && title && space) {
		const found = await findPageByTitle(cfg, space, title);
		if (found) existingPage = await getPage(cfg, found.id);
	}

	if (existingPage) {
		if (meta.version !== undefined && meta.version !== existingPage.version) {
			throw new Error(
				`Refusing to overwrite page ${existingPage.id}: the Markdown was read at version ${meta.version}, ` +
					`but Confluence is now at version ${existingPage.version}. Read the page again before editing.`,
			);
		}
		const risks = assessMarkdownRoundTripRisks(existingPage.storage);
		if (risks.length > 0 && !values["force-lossy"]) {
			throw new Error(
				`Refusing a lossy Markdown update of page ${existingPage.id}. The current page contains:\n` +
					risks.map((risk) => `  - ${risk}`).join("\n") +
					"\nUse the Confluence UI or edit the storage-format XHTML through the API so these features are preserved. " +
					"Pass --force-lossy only when intentionally replacing the page's native formatting.",
			);
		}
	}

	const { storage, localMedia } = markdownToStorage(content, dirname(values.file));

	const result = await createOrUpdatePage(cfg, {
		id: existingPage?.id ?? id,
		spaceKey: space ?? "",
		parentId,
		title: title!,
		storage,
	});

	console.log(`${existingPage ? "Updated" : result.version > 1 ? "Updated" : "Created"}: ${result.url}`);
	console.log(`Version: ${result.version}  Id: ${result.id}`);

	if (localMedia.size > 0) {
		const { uploaded, failed } = await uploadAttachments(cfg, result.id, localMedia);
		console.log(`Attachments: ${uploaded} uploaded, ${failed} failed`);
	}

	// Optionally refresh the local file's frontmatter with the new version/id.
	if (values["write-back"]) {
		const fm = buildFrontmatter({
			confluenceId: result.id,
			title: result.title,
			space: space,
			parentId,
			version: result.version,
			url: result.url,
		});
		await writeFile(values.file, fm + content.replace(/^---\n[\s\S]*?\n---\n?/, ""), "utf-8");
	}

	console.log(JSON.stringify({ pageId: result.id, url: result.url, title: result.title, version: result.version }));
}

main().catch((e) => {
	console.error("Error:", (e as Error).message);
	process.exit(1);
});
