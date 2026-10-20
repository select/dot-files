#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { supervise } from "../supervisor.ts";

const usage = "Usage: node scripts/supervise.ts --run-dir NEW_DIRECTORY --prompt-file FILE [--timeout-seconds 3600] -- [Pi model/tool/resource options]";
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const own = separator === -1 ? argv : argv.slice(0, separator);
const args = separator === -1 ? [] : argv.slice(separator + 1);
const allowed = new Set(["--run-dir", "--prompt-file", "--timeout-seconds"]);
const options = new Map<string, string>();
try {
	if (own.includes("--help")) {
		console.log(usage);
	} else {
		for (let i = 0; i < own.length; i += 2) {
			if (!allowed.has(own[i]) || !own[i + 1] || options.has(own[i])) throw new Error(usage);
			options.set(own[i], own[i + 1]);
		}
		const directory = options.get("--run-dir");
		const promptFile = options.get("--prompt-file");
		const seconds = Number(options.get("--timeout-seconds") ?? 3600);
		if (!directory || !promptFile || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error(usage);
		// One explicit prompt; don't pass additional positional prompts after --.
		const prompt = readFileSync(promptFile, "utf8");
		if (!prompt.trim()) throw new Error("Prompt file must not be empty");
		const controller = new AbortController();
		const abort = () => controller.abort();
		process.once("SIGTERM", abort);
		process.once("SIGINT", abort);
		try {
			const result = await supervise({ directory, args, prompt,
				timeoutMilliseconds: seconds * 1000, signal: controller.signal });
			console.log(JSON.stringify(result));
			process.exitCode = result.kind === "settled" && result.outcome === "completed" ? 0 : 1;
		} finally {
			process.removeListener("SIGTERM", abort);
			process.removeListener("SIGINT", abort);
		}
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
