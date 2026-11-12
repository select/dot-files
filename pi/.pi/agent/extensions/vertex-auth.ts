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
 *    - Provides `/vertex-login` for manual login and `/vertex-check` for explicit
 *      project/IAM diagnostics without model calls or automatic project changes.
 *
 * Debug log: ~/.pi/agent/vertex-auth.log
 */

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Api,
	AssistantMessageEventStream,
	Model,
	SimpleStreamOptions,
	TranscriptContext,
} from "@earendil-works/pi-ai/compat";
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

export async function checkVertexProject(baseUrl: string): Promise<{ message: string; level: "info" | "warning" | "error" }> {
	const url = new URL(baseUrl);
	const project = url.pathname.match(/^\/v1(?:beta1)?\/projects\/([^/]+)\/locations\//)?.[1];
	if (url.protocol !== "https:" || !/^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/.test(url.hostname) || !project) {
		return { level: "error", message: "Not a Google Vertex project endpoint; no credentials sent." };
	}
	const token = await getOrRefreshToken();
	if (!token) return { level: "error", message: "ADC token unavailable. Run /vertex-login." };
	const endpoint = `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(decodeURIComponent(project))}`;
	const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	const stateResponse = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10000) });
	if (stateResponse.ok) {
		const state = await stateResponse.json() as { lifecycleState?: string };
		if (state.lifecycleState && state.lifecycleState !== "ACTIVE") {
			return { level: "error", message: `Vertex project ${project} is ${state.lifecycleState}. Update the provider baseUrl to an approved active project; logging in again will not restore this project.` };
		}
	} else if (stateResponse.status === 401) {
		return { level: "error", message: "Google rejected the ADC token (401). Run /vertex-login." };
	}
	const response = await fetch(`${endpoint}:testIamPermissions`, {
		method: "POST", headers, signal: AbortSignal.timeout(10000),
		body: JSON.stringify({ permissions: ["aiplatform.endpoints.predict", "serviceusage.services.use"] }),
	});
	if (!response.ok) {
		return { level: "warning", message: `Could not inspect IAM for ${project} (HTTP ${response.status}). This does not prove model access is denied. Check the project and API access with its administrator; do not assume ADC expired.` };
	}
	const result = await response.json() as { permissions?: string[] };
	if (!result.permissions?.includes("aiplatform.endpoints.predict")) {
		return { level: "error", message: `ADC lacks aiplatform.endpoints.predict on ${project}. Ask an administrator for approved Vertex AI access (roles/aiplatform.user); re-login alone will not grant it.` };
	}
	const quota = result.permissions.includes("serviceusage.services.use")
		? "Quota-project permission is also present."
		: "No serviceusage.services.use permission: do not set this as the ADC quota project. Resource-project Vertex requests may still work.";
	return {
		level: "info",
		message: `${project}: prediction permission confirmed. ${quota}${stateResponse.ok ? "" : " Project lifecycle could not be inspected."} This check does not verify billing, API enablement, or model availability; no model request was made.`,
	};
}

const VERTEX_ANTHROPIC_VERSION = "vertex-2023-10-16";
let anthropicApi: ReturnType<typeof import("@earendil-works/pi-ai/compat").anthropicMessagesApi>;

export function createVertexAnthropicFetch(model: { id: string; baseUrl: string }, baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
	const publisherBase = model.baseUrl.replace(/\/+$/, "").replace(/\/publishers\/google$/, "/publishers/anthropic");
	const endpoint = new URL(publisherBase);
	if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port ||
		! /^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/.test(endpoint.hostname) ||
		!/^\/v1(?:beta1)?\/projects\/[^/]+\/locations\/[^/]+\/publishers\/anthropic$/.test(endpoint.pathname) ||
		endpoint.search || endpoint.hash) {
		throw new Error("Expected a Google Vertex Anthropic publisher endpoint");
	}
	const targetUrl = `${publisherBase}/models/${encodeURIComponent(model.id)}:streamRawPredict`;

	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		if (request.method !== "POST") throw new Error("Expected an Anthropic Messages POST request");
		const headers = new Headers(request.headers);
		headers.delete("x-api-key");
		headers.delete("anthropic-version");

		const parsed = JSON.parse(await request.text()) as Record<string, unknown>;
		delete parsed.model;
		delete parsed.betas;
		parsed.anthropic_version = VERTEX_ANTHROPIC_VERSION;

		return baseFetch(targetUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(parsed),
			signal: request.signal,
			redirect: "error",
		});
	}) as typeof fetch;
}

export function streamVertexAnthropic(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	return anthropicApi.streamSimple(model as Model<"anthropic-messages">, context, {
		...options,
		apiKey: undefined,
		fetch: createVertexAnthropicFetch(model, options?.fetch),
	});
}

// ---------------------------------------------------------------------------
// Pi Extension Factory
// ---------------------------------------------------------------------------
export default async function (pi: ExtensionAPI) {
	// Keep the standalone ADC resolver dependency-free; Pi supplies this import.
	const { anthropicMessagesApi } = await import("@earendil-works/pi-ai/compat");
	anthropicApi = anthropicMessagesApi();
	log("extension factory loaded");
	for (const providerId of ["vertex", "vertex-global"]) {
		pi.registerProvider(providerId, {
			api: "anthropic-messages",
			streamSimple: streamVertexAnthropic,
		});
	}
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
			const token = await getOrRefreshToken(true);
			ctx.ui.notify(token ? "Vertex ADC refreshed ✓ (project access is separate; use /vertex-check)" : "Login completed but ADC token refresh failed", token ? "info" : "error");
			return Boolean(token);
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

	pi.registerCommand("vertex-check", {
		description: "Check the selected Vertex project's lifecycle and ADC permissions (no model call)",
		handler: async (_args, ctx) => {
			if (!ctx.model?.provider.startsWith(VERTEX_PREFIX)) {
				ctx.ui.notify("Select a Vertex model first, then run /vertex-check.", "warning");
				return;
			}
			try {
				const result = await checkVertexProject(ctx.model.baseUrl);
				ctx.ui.notify(result.message, result.level);
			} catch {
				ctx.ui.notify("Vertex project check failed (network, timeout, or invalid configuration). No project or IAM settings were changed.", "warning");
			}
		},
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
