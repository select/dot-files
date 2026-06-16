#!/usr/bin/env bun
/**
 * Search Confluence for pages/documents.
 *
 * Usage:
 *   bun search.ts --query "vertex ai adc"
 *   bun search.ts --query "onboarding" --space AP --limit 10
 *   bun search.ts --cql 'type=page AND title ~ "sprint"' --limit 50
 *   bun search.ts --query "gemini" --json
 *
 * Free-text --query is turned into a CQL `text ~ "..."` search (optionally
 * scoped to --space and --type). Use --cql to pass a raw CQL expression.
 */

import { parseArgs } from "node:util";
import { loadConfig, search } from "./confluence.ts";

function buildCql(query: string, space?: string, type = "page"): string {
	const safe = query.replace(/"/g, '\\"');
	const parts = [`siteSearch ~ "${safe}"`];
	if (type) parts.push(`type = "${type}"`);
	if (space) parts.push(`space = "${space}"`);
	return parts.join(" AND ") + " ORDER BY lastModified DESC";
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			query: { type: "string" },
			cql: { type: "string" },
			space: { type: "string" },
			type: { type: "string", default: "page" },
			limit: { type: "string", default: "25" },
			json: { type: "boolean", default: false },
		},
	});

	if (!values.query && !values.cql) {
		console.error('Usage: bun search.ts --query "text" [--space KEY] [--limit N] [--json]');
		console.error("   or: bun search.ts --cql '<raw CQL>'");
		process.exit(1);
	}

	const cfg = loadConfig();
	const cql = values.cql ?? buildCql(values.query!, values.space, values.type);
	const hits = await search(cfg, cql, Number(values.limit));

	if (values.json) {
		console.log(JSON.stringify(hits, null, 2));
		return;
	}

	if (hits.length === 0) {
		console.log("No results.");
		return;
	}
	console.log(`Found ${hits.length} result(s):\n`);
	for (const h of hits) {
		const when = h.lastModified ? new Date(h.lastModified).toISOString().slice(0, 10) : "?";
		console.log(`• ${h.title}  [${h.space ?? "?"} · ${h.type} · ${h.id} · ${when}]`);
		console.log(`  ${h.url}`);
		if (h.excerpt) console.log(`  ${h.excerpt.slice(0, 160)}`);
		console.log();
	}
}

main().catch((e) => {
	console.error("Error:", (e as Error).message);
	process.exit(1);
});
