---
confluenceId: 4620156929
title: "Using Gemini in pi via Google Vertex AI (ADC)"
space: AP
parentId: 4431872013
version: 5
url: https://apheris.atlassian.net/wiki/spaces/AP/pages/4620156929/Using+Gemini+in+pi+via+Google+Vertex+AI+ADC
---
# Using Gemini in pi via Google Vertex AI (ADC)

This page documents how we got Google Gemini models working inside the **pi** coding agent using **Google Vertex AI** with **Application Default Credentials (ADC)** — the Google-recommended auth approach (no static API key).

## TL;DR

- Gemini works in pi through Vertex AI on the `driven-country-453015-a0`** (GoogleGPU-PoC)** GCP project.
- The `apheris` project was a dead end — no IAM permissions to enable APIs there.
- pi's `models.json` does **not** support a `google-vertex` API type for custom providers; use `google-generative-ai` pointed at the Vertex path with an OAuth Bearer token.
- Gemini 2.5 models are available in `europe-west1` (EU residency); Gemini 3.x is only in the `global` location.

---

## 1. Project selection

`gcloud projects list` revealed:

- `driven-country-453015-a0` — display name **GoogleGPU-PoC** (used here)
- `gpt-search-1682410739147`

---

## 2. One-time setup

Install and authenticate the Google Cloud CLI:

```bash
sudo snap install google-cloud-cli --classic
gcloud auth login
gcloud config set project driven-country-453015-a0
```

Enable the Vertex AI API on the project:

```bash
gcloud services enable aiplatform.googleapis.com --project=driven-country-453015-a0
```

Create Application Default Credentials and set the quota project:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project driven-country-453015-a0
```

Credentials are stored at `~/.config/gcloud/application_default_credentials.json`.

---

## 3. pi configuration

Edit `~/.pi/agent/models.json` and add the providers below. **Key finding:** pi's custom-provider `models.json` only supports the API types `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai`. There is **no **`google-vertex` type. To use Vertex we point the `google-generative-ai` type at the Vertex `.../publishers/google` path and authenticate with an OAuth2 Bearer token (`"authHeader": true`) whose value comes from a shell command that prints a fresh ADC access token at request time.

In addition, because Vertex AI APIs do not return cost information in their responses, we must explicitly define the `"cost"` object (values in USD per million tokens) so that pi can accurately calculate and track usage costs in the footer and session logs.

In addition we want to set `enabledModels` so we can cycle through to Gemini with `crl + p`.

```json
{
  "enabledModels": [
    "eu.anthropic.claude-sonnet-4-6",
    "eu.anthropic.claude-opus-4-8",
    "vertex-global/gemini-3.5-flash"
  ],
  "providers": {
    "vertex": {
      "baseUrl": "https://europe-west1-aiplatform.googleapis.com/v1/projects/driven-country-453015-a0/locations/europe-west1/publishers/google",
      "api": "google-generative-ai",
      "apiKey": "!gcloud auth application-default print-access-token",
      "authHeader": true,
      "models": [
        { "id": "gemini-2.5-pro",   "name": "Gemini 2.5 Pro (Vertex)",   "reasoning": true, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 65536, "cost": { "input": 1.25, "output": 10.0, "cacheRead": 0.125, "cacheWrite": 0.0 } },
        { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (Vertex)", "reasoning": true, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 65536, "cost": { "input": 0.30, "output": 2.50,  "cacheRead": 0.03,  "cacheWrite": 0.0 } }
      ]
    },
    "vertex-global": {
      "baseUrl": "https://aiplatform.googleapis.com/v1/projects/driven-country-453015-a0/locations/global/publishers/google",
      "api": "google-generative-ai",
      "apiKey": "!gcloud auth application-default print-access-token",
      "authHeader": true,
      "models": [
        { "id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro (Vertex global)",   "reasoning": true, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 65536, "cost": { "input": 2.0,  "output": 12.0, "cacheRead": 0.20,  "cacheWrite": 0.0 } },
        { "id": "gemini-3.5-flash",       "name": "Gemini 3.5 Flash (Vertex global)", "reasoning": true, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 65536, "cost": { "input": 1.50, "output": 9.00,  "cacheRead": 0.15,  "cacheWrite": 0.0 } }
      ]
    }
  }
}
```

---

## 4. Region vs. global

- **Gemini 2.5** (`gemini-2.5-pro`, `gemini-2.5-flash`) is served from `europe-west1` — keeps data in the EU.
- **Gemini 3.x** (`gemini-3.1-pro-preview`, `gemini-3.5-flash`, etc.) is only available from the `global` location — **no EU data residency**. This is why there are two providers.

List the models available in a project/region:

```bash
TOKEN=$(gcloud auth application-default print-access-token)
curl -s "https://aiplatform.googleapis.com/v1beta1/publishers/google/models" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: driven-country-453015-a0" \
  | python3 -c "import sys,json; [print(m['name'].split('/')[-1]) for m in json.load(sys.stdin)['publisherModels'] if 'gemini' in m['name']]"
```

### Model availability by region

Measured against project `driven-country-453015-a0` by issuing a real `generateContent`

request per model/region (OK = HTTP 200, served; otherwise HTTP 404, not served).

Tested 2026-06-15. Regions tested: `global`, `us-central1`, `europe-west1`, `europe-west4`.

**Available in all regions** (global, us-central1, europe-west1, europe-west4) — use the EU regions for data residency:

- gemini-2.5-pro
- gemini-2.5-flash
- gemini-2.5-flash-lite

**Available in **`global`** only** (no regional / EU endpoint yet):

- gemini-3.1-pro-preview
- gemini-3.5-flash
- gemini-3-flash-preview
- gemini-3.1-flash-lite

**Listed but not usable on this project** (appear in the publisher catalogue but return 404 on `generateContent`):

- gemini-2.0-flash-001
- gemini-1.5-pro-002

**Takeaways:** the Gemini 2.5 family is the choice for EU data residency (`europe-west1` / `europe-west4`); the Gemini 3.x family currently requires the `global` endpoint, which does not keep data in the EU.

---

## 5. Usage

In pi, run `/model` (press **Tab** to switch to the "all" scope if a model is hidden) and

pick **Gemini 2.5 Pro/Flash (Vertex)** or one of the **(Vertex global)** 3.x models.

Non-interactive smoke test:

```bash
pi --provider vertex --model gemini-2.5-flash -p "say OK"
pi --provider vertex-global --model gemini-3.5-flash -p "say OK"
```

---

## 6. Troubleshooting

- `API keys are not supported by this API` — you used a literal `apiKey`. Vertex needs an OAuth Bearer token; use the `authHeader: true` + token-command approach above.
- `"apiKey" is required when defining custom models` — pi validation requires the field to be present; the `!gcloud ...` command value satisfies it.
- **Auth expired** — ADC OAuth credentials expire periodically (`Reauthentication failed`). Because pi resolves the `apiKey` command at request time and does **not** retry it, an expired token surfaces in pi as:
```
Error: Failed to resolve API key for provider "vertex-global" from shell command: gcloud auth application-default print-access-token
```
**Fix:** run `gcloud auth application-default login` in a terminal (opens a browser), then retry. To avoid hitting this mid-task, use the optional pi extension in section 7, which detects the expired token and triggers the login for you.
- **404 for a model** — that model isn't served in the chosen location. Gemini 3.x must use the `global` endpoint.

## 7. Auto-refreshing ADC with a pi extension (optional)

ADC tokens expire, and pi resolves the `apiKey` shell command at request time without retrying it. So when the token is stale the next request fails with the error shown in section 6, and you have to stop and re-authenticate by hand.

**When to use what:**

- **Without the extension (manual):** when you see `Error: Failed to resolve API key for provider "vertex-global" ...`, run `gcloud auth application-default login` in a terminal, complete the browser consent, and resend your prompt. Simple, nothing to install.
- **With the extension (automatic):** install the extension below once. It checks the token whenever a `vertex*` model is active (on prompt submit / model switch) and, if expired, pops a confirm dialog and runs the login for you — opening the browser before the request fails. You never see the raw error. Also adds a `/vertex-login` command for an on-demand refresh.

 The browser still opens for the OAuth consent — that step cannot be fully silent. On a headless/remote machine `gcloud` prints a URL instead. For a truly non-interactive setup (no browser ever), use a service-account key via `GOOGLE_APPLICATION_CREDENTIALS` instead of user ADC.

**Install:** save the file as `~/.pi/agent/extensions/vertex-auth.ts` (extensions in that folder are auto-discovered) and restart pi.

```typescript
/**
 * Vertex Auth Extension  (~/.pi/agent/extensions/vertex-auth.ts)
 *
 * The `vertex` / `vertex-global` providers resolve their API key via
 * `!gcloud auth application-default print-access-token`. Those ADC credentials
 * expire and eventually need an interactive re-login, which otherwise fails
 * mid-request with:
 *
 *   Error: Failed to resolve API key for provider "vertex-global" from shell
 *   command: gcloud auth application-default print-access-token
 *
 * This extension pre-flights the token whenever a vertex* model is active and,
 * if it is stale, offers to run `gcloud auth application-default login`
 * (which opens a browser) before any request fails. Also adds `/vertex-login`.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const VERTEX_PREFIX = "vertex";
const PRINT_TOKEN = ["auth", "application-default", "print-access-token"];
const LOGIN = ["auth", "application-default", "login"];

type ExecResult = { stdout: string; stderr: string; code: number; killed?: boolean };

export default function (pi: ExtensionAPI) {
	let inFlight = false;

	const exec = (args: string[], timeout: number): Promise =>
		pi
			.exec("gcloud", args, { timeout })
			.then((r) => r as ExecResult)
			.catch((err) => ({ stdout: "", stderr: String(err?.message ?? err), code: 1 }));

	const tokenValid = async (): Promise => {
		const r = await exec(PRINT_TOKEN, 15000);
		return r.code === 0 && r.stdout.trim().length > 0;
	};

	const relogin = async (ctx: ExtensionContext): Promise => {
		ctx.ui.setStatus("vertex-auth", "gcloud login… (check your browser)");
		// Long timeout: the user has to complete the OAuth consent in the browser.
		const r = await exec(LOGIN, 5 * 60 * 1000);
		ctx.ui.setStatus("vertex-auth", undefined);

		if (r.code === 0) {
			ctx.ui.notify("Vertex ADC refreshed ✓", "info");
			return true;
		}
		const detail = (r.stderr || r.stdout).trim().slice(0, 240);
		ctx.ui.notify(`gcloud login failed: ${detail || "unknown error"}`, "error");
		return false;
	};

	const ensureAuth = async (ctx: ExtensionContext, provider: string | undefined): Promise => {
		if (!provider?.startsWith(VERTEX_PREFIX)) return;
		if (!ctx.hasUI) return; // login needs a human + browser (hasUI: true in TUI/RPC)
		if (inFlight) return;

		inFlight = true;
		try {
			if (await tokenValid()) return;
			const ok = await ctx.ui.confirm(
				"Vertex credentials expired",
				"Run `gcloud auth application-default login` now? This opens a browser.",
			);
			if (ok) await relogin(ctx);
		} finally {
			inFlight = false;
		}
	};

	// Primary gate: fires when the user submits a prompt, with the model active.
	// pi awaits this before the agent loop, so login finishes before any request.
	pi.on("before_agent_start", async (_event, ctx) => {
		await ensureAuth(ctx, ctx.model?.provider);
	});

	// Best-effort earlier checks (ctx.model may be unset this early at startup).
	pi.on("session_start", async (_event, ctx) => {
		await ensureAuth(ctx, ctx.model?.provider);
	});
	pi.on("model_select", async (event, ctx) => {
		await ensureAuth(ctx, event.model?.provider);
	});

	pi.registerCommand("vertex-login", {
		description: "Refresh gcloud Application Default Credentials for Vertex providers",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Run /vertex-login in interactive mode", "warning");
				return;
			}
			await relogin(ctx);
		},
	});
}
```

**Notes**

- The installed pi build (`@earendil-works/pi-coding-agent` 0.79.x) exposes `ctx.hasUI` (true in TUI/RPC), **not** `ctx.isInteractive` — guarding on the wrong field makes the check silently skip.
- `before_agent_start` is the reliable gate: `ctx.model` is populated there, unlike at `session_start`, and pi awaits it before sending the request.

---

## 8. Cost Tracking & `/session-breakdown`

Because Google's Vertex AI APIs do not return billing or cost information in their prediction responses, `pi` cannot automatically determine session costs without help. 

Defining a `"cost"` object on each model inside `models.json` tells `pi` how to log billing data locally:
- **Future Sessions:** Automatically calculated and logged correctly inside your `.jsonl` session history.
- **Cost Structure:** Prices are defined in **USD per 1 million tokens** (with `cacheWrite` set to `0.0` since GCP does not charge separate cache-write overhead):
  - **Gemini 2.5 Flash:** Input: `$0.30` | Output: `$2.50` | Cache Read: `$0.03`
  - **Gemini 2.5 Pro:** Input: `$1.25` | Output: `$10.00` | Cache Read: `$0.125`
  - **Gemini 3.5 Flash:** Input: `$1.50` | Output: `$9.00` | Cache Read: `$0.15`
  - **Gemini 3.1 Pro:** Input: `$2.00` | Output: `$12.00` | Cache Read: `$0.20`

### Retroactive Cost Calculations
If you ran Gemini sessions prior to adding `"cost"` parameters, those old sessions will have logged `$0.00` cost. 
To correct this, our **`session-breakdown.ts`** extension includes a fallback pricing map matching the Vertex costs above. When scanning, if it encounters any Vertex session with `$0.00` cost, it automatically extracts the token usage from the log and computes the correct retroactive cost dynamically.

---

---

## Admin notes / access

To use Vertex on a project you need:

- The **Vertex AI API** enabled on the project (`gcloud services enable aiplatform.googleapis.com`).
- IAM role `roles/aiplatform.user` to make prediction requests.
- To enable the API yourself you also need `roles/serviceusage.serviceUsageAdmin`.
