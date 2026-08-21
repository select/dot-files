/**
 * Vertex Auth Extension & Token Resolver
 *
 * This single file serves two purposes:
 * 1. CLI Token Resolver (invoked by models.json via `!bun run ~/.pi/agent/extensions/vertex-auth.ts`):
 *    - Returns cached Google Cloud ADC access tokens in <10ms.
 *    - Directly refreshes tokens via Google OAuth2 endpoint (~100ms) on expiration,
 *      avoiding the 5-15s `gcloud` CLI startup delay.
 * 2. Pi Extension (auto-loaded by Pi):
 *    - Pre-flights the token before agent turns (`before_agent_start`) and model selection.
 *    - Prompts the user to run `gcloud auth application-default login` only when the
 *      refresh token is truly revoked or expired.
 *    - Provides the `/vertex-login` command for manual interactive login.
 *
 * Debug log: ~/.pi/agent/vertex-auth.log
 */

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const VERTEX_PREFIX = "vertex";
const LOGIN_ARGS = ["auth", "application-default", "login"];
const LOG_FILE = join(homedir(), ".pi", "agent", "vertex-auth.log");

const uid = typeof process.getuid === "function" ? process.getuid() : "user";
const CACHE_FILE = join(tmpdir(), `vertex-adc-token-${uid}.json`);
const ADC_FILE = join(homedir(), ".config", "gcloud", "application_default_credentials.json");

// Buffer in ms before actual token expiration to trigger refresh
const EXPIRY_BUFFER_MS = 120 * 1000; // 2 minutes

type ExecResult = { stdout: string; stderr: string; code: number; killed?: boolean };

const log = (msg: string, data?: unknown): void => {
	const line = `[${new Date().toISOString()}] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}\n`;
	try {
		appendFileSync(LOG_FILE, line);
	} catch {
		// ignore logging failures
	}
};

export function readCachedToken(): string | null {
	try {
		if (!existsSync(CACHE_FILE)) return null;
		const raw = readFileSync(CACHE_FILE, "utf8");
		const data = JSON.parse(raw);
		if (
			typeof data.token === "string" &&
			data.token.length > 0 &&
			typeof data.expires_at === "number" &&
			data.expires_at > Date.now() + EXPIRY_BUFFER_MS
		) {
			return data.token;
		}
	} catch {
		// Ignore corrupted cache
	}
	return null;
}

export function saveToken(token: string, expiresInSec = 3600): void {
	try {
		const expiresAt = Date.now() + Math.max(expiresInSec - 120, 60) * 1000;
		writeFileSync(CACHE_FILE, JSON.stringify({ token, expires_at: expiresAt }), { mode: 0o600 });
	} catch {
		// Ignore write errors
	}
}

export async function refreshViaDirectOAuth(): Promise<string | null> {
	if (!existsSync(ADC_FILE)) return null;

	let adc: { type?: string; refresh_token?: string; client_id?: string; client_secret?: string };
	try {
		adc = JSON.parse(readFileSync(ADC_FILE, "utf8"));
	} catch {
		return null;
	}

	if (adc.type !== "authorized_user" || !adc.refresh_token || !adc.client_id || !adc.client_secret) {
		return null;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);

	try {
		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: adc.client_id,
				client_secret: adc.client_secret,
				refresh_token: adc.refresh_token,
				grant_type: "refresh_token",
			}),
			signal: controller.signal,
		});

		if (!res.ok) return null;

		const data = (await res.json()) as { access_token?: string; expires_in?: number };
		if (data.access_token) {
			const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
			saveToken(data.access_token, expiresIn);
			return data.access_token;
		}
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}

	return null;
}

export function refreshViaGcloud(): string | null {
	try {
		const stdout = execSync("gcloud auth application-default print-access-token", {
			encoding: "utf8",
			timeout: 9000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		if (stdout && stdout.length > 0) {
			saveToken(stdout, 3000);
			return stdout;
		}
	} catch {
		return null;
	}
	return null;
}

export async function getOrRefreshToken(force = false): Promise<string | null> {
	if (!force) {
		const cached = readCachedToken();
		if (cached) return cached;
	}

	// 1. Direct OAuth refresh (fast: ~100ms)
	const directToken = await refreshViaDirectOAuth();
	if (directToken) return directToken;

	// 2. Fallback to gcloud
	const gcloudToken = refreshViaGcloud();
	if (gcloudToken) return gcloudToken;

	return null;
}

// ---------------------------------------------------------------------------
// Pi Extension Factory
// ---------------------------------------------------------------------------
export default function (pi: ExtensionAPI) {
	log("extension factory loaded");
	let inFlight = false;

	const tokenValid = async (): Promise<boolean> => {
		const token = await getOrRefreshToken(false);
		const valid = typeof token === "string" && token.length > 0;
		log("tokenValid", { valid });
		return valid;
	};

	const relogin = async (ctx: ExtensionContext): Promise<boolean> => {
		log("relogin start");
		ctx.ui.setStatus("vertex-auth", "gcloud login… (check your browser)");
		const r = (await pi.exec("gcloud", LOGIN_ARGS, { timeout: 5 * 60 * 1000 }).catch((err) => ({
			stdout: "",
			stderr: String(err?.message ?? err),
			code: 1,
		}))) as ExecResult;
		ctx.ui.setStatus("vertex-auth", undefined);
		log("relogin done", { code: r.code, stderr: r.stderr.trim().slice(0, 300) });

		if (r.code === 0) {
			await getOrRefreshToken(true);
			ctx.ui.notify("Vertex ADC refreshed ✓", "info");
			return true;
		}
		const detail = (r.stderr || r.stdout).trim().slice(0, 240);
		ctx.ui.notify(`gcloud login failed: ${detail || "unknown error"}`, "error");
		return false;
	};

	const ensureAuth = async (ctx: ExtensionContext, provider: string | undefined, where: string): Promise<void> => {
		log("ensureAuth", { where, provider, hasUI: ctx.hasUI, mode: ctx.mode, inFlight });
		if (!provider?.startsWith(VERTEX_PREFIX)) return;
		if (!ctx.hasUI) return;
		if (inFlight) return;

		inFlight = true;
		try {
			if (await tokenValid()) {
				log("ensureAuth: token valid, nothing to do");
				return;
			}

			log("ensureAuth: prompting user to login");
			const ok = await ctx.ui.confirm(
				"Vertex credentials expired",
				"Run `gcloud auth application-default login` now? This opens a browser.",
			);
			log("ensureAuth: confirm result", { ok });
			if (ok) await relogin(ctx);
		} finally {
			inFlight = false;
		}
	};

	pi.on("before_agent_start", async (_event, ctx) => {
		log("event: before_agent_start", { model: ctx.model });
		await ensureAuth(ctx, ctx.model?.provider, "before_agent_start");
	});

	pi.on("session_start", async (_event, ctx) => {
		log("event: session_start", { model: ctx.model });
		await ensureAuth(ctx, ctx.model?.provider, "session_start");
	});

	pi.on("model_select", async (event, ctx) => {
		log("event: model_select", { eventModel: event.model });
		await ensureAuth(ctx, event.model?.provider, "model_select");
	});

	pi.registerCommand("vertex-login", {
		description: "Refresh gcloud Application Default Credentials for Vertex providers",
		handler: async (_args, ctx) => {
			log("command: /vertex-login", { hasUI: ctx.hasUI, mode: ctx.mode });
			if (!ctx.hasUI) {
				ctx.ui.notify("Run /vertex-login in interactive mode", "warning");
				return;
			}
			await relogin(ctx);
		},
	});
}

// ---------------------------------------------------------------------------
// CLI Execution Entrypoint (when invoked directly by models.json via Bun/Node)
// ---------------------------------------------------------------------------
if (import.meta.main || (typeof require !== "undefined" && require.main === module)) {
	const force = process.argv.includes("--force");
	getOrRefreshToken(force).then((token) => {
		if (token) {
			process.stdout.write(token);
			process.exit(0);
		} else {
			console.error("Failed to resolve Vertex access token");
			process.exit(1);
		}
	});
}
