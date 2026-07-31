/**
 * Bedrock Auth Extension
 *
 * Ensures AWS credentials are available before pi resolves its model catalogue.
 * Concurrent pi processes serialize aws-vault through flock, so only the first
 * process can start an SSO/browser login. Waiting processes reuse the refreshed
 * SSO session and then receive their own temporary credentials.
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROFILE = "test-sso";
const LOCK_TIMEOUT_SECONDS = 10 * 60;
const REFRESH_MARGIN_MS = 60_000;
const MARKER = "PI_AWS_CREDENTIALS=";
const AWS_VARIABLES = [
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_SECURITY_TOKEN",
	"AWS_CREDENTIAL_EXPIRATION",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
] as const;
const UNSET_VARIABLES = ["AWS_VAULT", ...AWS_VARIABLES] as const;

const credentialsValid = (): boolean => {
	if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return false;

	const expiration = process.env.AWS_CREDENTIAL_EXPIRATION;
	if (!expiration) return true;

	const expiresAt = Date.parse(expiration);
	return Number.isFinite(expiresAt) && expiresAt > Date.now() + REFRESH_MARGIN_MS;
};

const applyCredentials = (credentials: Record<string, unknown>): boolean => {
	if (typeof credentials.AWS_ACCESS_KEY_ID !== "string" || typeof credentials.AWS_SECRET_ACCESS_KEY !== "string") {
		return false;
	}

	for (const variable of AWS_VARIABLES) {
		const value = credentials[variable];
		if (typeof value === "string" && value.length > 0) process.env[variable] = value;
	}
	return true;
};

export default async function (pi: ExtensionAPI): Promise<void> {
	const refresh = async (force = false): Promise<{ ok: boolean; error?: string }> => {
		if (!force && credentialsValid()) return { ok: true };

		const lock = process.env.XDG_RUNTIME_DIR
			? join(process.env.XDG_RUNTIME_DIR, "pi-bedrock-auth.lock")
			: `/tmp/pi-bedrock-auth-${process.getuid?.() ?? "user"}.lock`;
		const script = `const keys=${JSON.stringify(AWS_VARIABLES)};const out={};for(const key of keys){if(process.env[key])out[key]=process.env[key]}console.log(${JSON.stringify(MARKER)}+JSON.stringify(out))`;
		const args = [
			...UNSET_VARIABLES.flatMap((variable) => ["-u", variable]),
			"flock",
			"--exclusive",
			"--timeout",
			String(LOCK_TIMEOUT_SECONDS),
			lock,
			"aws-vault",
			"exec",
			PROFILE,
			"--",
			process.execPath,
			"-e",
			script,
		];
		const result = await pi.exec("env", args, { timeout: (LOCK_TIMEOUT_SECONDS + 30) * 1000 }).catch((error) => ({
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			code: 1,
			killed: false,
		}));

		if (result.code !== 0) {
			return { ok: false, error: (result.stderr || result.stdout).trim() || `aws-vault exited with ${result.code}` };
		}

		const line = result.stdout
			.split("\n")
			.reverse()
			.find((value) => value.startsWith(MARKER));
		if (!line) return { ok: false, error: "aws-vault did not return credentials" };

		const credentials = JSON.parse(line.slice(MARKER.length)) as Record<string, unknown>;
		if (!applyCredentials(credentials)) return { ok: false, error: "aws-vault returned incomplete credentials" };
		return { ok: true };
	};

	// Async extension factories are awaited before pi resolves providers/models.
	// Do not throw on failure: pi should remain usable with non-Bedrock providers.
	const initial = await refresh();
	if (!initial.ok) console.error(`bedrock-auth: ${initial.error}`);

	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== "amazon-bedrock" || credentialsValid()) return;

		ctx.ui.setStatus("bedrock-auth", "Refreshing AWS credentials…");
		const result = await refresh();
		ctx.ui.setStatus("bedrock-auth", undefined);
		if (!result.ok) ctx.ui.notify(`Bedrock login failed: ${result.error}`, "error");
	});

	pi.registerCommand("bedrock-login", {
		description: `Refresh AWS credentials through aws-vault (${PROFILE})`,
		handler: async (_args, ctx) => {
			ctx.ui.setStatus("bedrock-auth", "Refreshing AWS credentials…");
			const result = await refresh(true);
			if (result.ok) await ctx.modelRegistry.refresh();
			ctx.ui.setStatus("bedrock-auth", undefined);
			ctx.ui.notify(
				result.ok ? "Bedrock credentials refreshed ✓" : `Bedrock login failed: ${result.error}`,
				result.ok ? "info" : "error",
			);
		},
	});
}
