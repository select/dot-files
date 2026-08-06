/**
 * Bedrock Auth Extension
 *
 * Advertises Bedrock models immediately, then obtains AWS credentials lazily
 * before the first Bedrock request. Concurrent pi processes serialize aws-vault
 * through flock, so only the first process can start an SSO/browser login.
 * Waiting processes reuse the refreshed SSO session and then receive their own
 * temporary credentials.
 */

import { join } from "node:path";
import { bedrockConverseStreamApi, createProvider, getModels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI): void {
	let touched = false;

	// pi currently redirects extension imports from pi-ai's root to its legacy
	// compatibility entrypoint, which still exports getModels(). Re-registering
	// the native provider with lazy auth makes its static catalogue available
	// before enabledModels is resolved, without opening an SSO login at startup.
	pi.registerProvider(
		createProvider({
			id: "amazon-bedrock",
			name: "Amazon Bedrock (aws-vault)",
			auth: {
				apiKey: {
					name: `aws-vault (${PROFILE})`,
					resolve: async () => {
						touched = true;
						return { auth: {}, source: `aws-vault (${PROFILE}, lazy)` };
					},
				},
			},
			models: getModels("amazon-bedrock"),
			api: bedrockConverseStreamApi(),
		}),
	);

	let inflight: Promise<{ ok: boolean; error?: string }> | undefined;

	const refresh = async (force = false): Promise<{ ok: boolean; error?: string }> => {
		if (!force && credentialsValid()) return { ok: true };
		if (inflight) return inflight;
		inflight = run(force);
		const result = await inflight.finally(() => {
			inflight = undefined;
		});
		return result;
	};

	const run = async (force: boolean): Promise<{ ok: boolean; error?: string }> => {
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

	// Any code path that talks to Bedrock (turn start, model switch, compaction /
	// summarization, plus a catch-all right before the HTTP request) has to see
	// valid credentials, otherwise the AWS SDK falls back to its default chain and
	// fails with "Could not load credentials from any providers".
	const ensure = async (ctx: ExtensionContext, quiet = false): Promise<boolean> => {
		if (usesBedrock(ctx) === false || credentialsValid()) return true;

		ctx.ui.setStatus("bedrock-auth", "Refreshing AWS credentials…");
		const result = await refresh();
		ctx.ui.setStatus("bedrock-auth", undefined);
		if (!result.ok && !quiet) ctx.ui.notify(`Bedrock login failed: ${result.error}`, "error");
		return result.ok;
	};

	// undefined model (e.g. during compaction) is treated as "maybe bedrock" only
	// when bedrock creds were used at least once in this process.
	const usesBedrock = (ctx: ExtensionContext): boolean => {
		if (ctx.model?.provider) return ctx.model.provider === "amazon-bedrock";
		return touched;
	};

	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider === "amazon-bedrock") touched = true;
		await ensure(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.model?.provider !== "amazon-bedrock") return;
		touched = true;
		await ensure(ctx);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		await ensure(ctx);
	});

	pi.on("session_before_tree", async (_event, ctx) => {
		await ensure(ctx);
	});

	pi.on("before_provider_request", async (_event, ctx) => {
		await ensure(ctx, true);
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
