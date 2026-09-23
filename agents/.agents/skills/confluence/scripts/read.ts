#!/usr/bin/env bun
/**
 * Read a Confluence page and save it as Markdown.
 *
 * Usage:
 *   bun read.ts --id 123456789
 *   bun read.ts --url "https://wiki.example.com/wiki/spaces/AP/pages/123456789/Title"
 *   bun read.ts --title "Using a cloud model with application default credentials" --space AP
 *   bun read.ts --id 123456789 --out ./page.md
 *   bun read.ts --id 123456789 --stdout   # print, don't write a file
 *
 * Writes Markdown with a YAML frontmatter block (confluenceId, title, space,
 * version, url) so the file can be edited and pushed back with write.ts.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
	assessMarkdownRoundTripRisks,
	buildFrontmatter,
	getPage,
	loadConfig,
	resolvePageId,
	storageToMarkdown,
} from "./confluence.ts";

function slug(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			id: { type: "string" },
			url: { type: "string" },
			title: { type: "string" },
			space: { type: "string" },
			out: { type: "string" },
			stdout: { type: "boolean", default: false },
		},
	});

	const cfg = loadConfig();
	const id = await resolvePageId(cfg, values);
	const page = await getPage(cfg, id);
	const roundTripRisks = assessMarkdownRoundTripRisks(page.storage);
	if (roundTripRisks.length > 0) {
		console.error("Warning: this page contains Confluence features that Markdown cannot preserve faithfully:");
		for (const risk of roundTripRisks) console.error(`  - ${risk}`);
		console.error("write.ts will refuse to replace this page unless --force-lossy is explicitly provided.");
	}

	const md =
		buildFrontmatter({
			confluenceId: page.id,
			title: page.title,
			space: page.spaceKey,
			parentId: page.ancestors.at(-1),
			version: page.version,
			url: page.url,
		}) +
		storageToMarkdown(page.storage);

	if (values.stdout) {
		process.stdout.write(md);
		return;
	}

	const outPath = values.out ?? `confluence/${page.id}-${slug(page.title)}.md`;
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, md, "utf-8");

	console.log(`Saved: ${outPath}`);
	console.log(`Title: ${page.title}`);
	console.log(`Space: ${page.spaceKey}  Version: ${page.version}  Id: ${page.id}`);
	console.log(`URL:   ${page.url}`);
	console.log(JSON.stringify({ pageId: page.id, file: outPath, title: page.title, version: page.version, url: page.url }));
}

main().catch((e) => {
	console.error("Error:", (e as Error).message);
	process.exit(1);
});
