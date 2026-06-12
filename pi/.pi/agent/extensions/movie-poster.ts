/**
 * Movie Poster Extension
 *
 * Displays movie posters inline in the terminal using the Kitty graphics protocol.
 * Supported in Ghostty, Kitty, WezTerm, and iTerm2.
 *
 * Usage:
 *   /poster Akira
 *   /poster Ghost in the Shell 1995
 *   /poster Planetes
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Image, Text, Container, Spacer } from "@mariozechner/pi-tui";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function findImdbId(title: string): Promise<{ id: string; label: string; year: string } | null> {
  const encoded = encodeURIComponent(title);
  const res = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encoded}.json`);
  if (!res.ok) return null;
  const data = (await res.json()) as { d?: { id: string; l: string; y: string; q: string }[] };
  const results = data.d ?? [];
  const hit = results.find((r) => r.q === "feature" || r.q === "TV series" || r.q === "TV mini-series") ?? results[0];
  if (!hit) return null;
  return { id: hit.id, label: hit.l, year: String(hit.y ?? "") };
}

async function fetchPosterUrl(imdbId: string): Promise<string | null> {
  const res = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/"image":"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/);
  return match?.[1] ?? null;
}

async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const mimeType = contentType.split(";")[0]!.trim();
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { base64, mimeType };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("poster", {
    description: "Show a movie poster inline. Usage: /poster <title> [year]",
    handler: async (args, ctx) => {
      const title = args?.trim();
      if (!title) {
        ctx.ui.notify("Usage: /poster <movie title>", "error");
        return;
      }

      ctx.ui.notify(`🔍 Searching for "${title}"...`, "info");

      const match = await findImdbId(title);
      if (!match) {
        ctx.ui.notify(`Could not find "${title}" on IMDB.`, "error");
        return;
      }

      ctx.ui.notify(`🎬 Found: ${match.label} (${match.year}) — fetching poster...`, "info");

      const posterUrl = await fetchPosterUrl(match.id);
      if (!posterUrl) {
        ctx.ui.notify(`No poster found for ${match.label}.`, "error");
        return;
      }

      const imageData = await downloadImageAsBase64(posterUrl);
      if (!imageData) {
        ctx.ui.notify("Failed to download poster.", "error");
        return;
      }

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const imageTheme = { fallbackColor: (s: string) => theme.fg("muted", s) };
        const image = new Image(imageData.base64, imageData.mimeType, imageTheme, {
          maxWidthCells: 60,
        });

        const title_line = `\x1b[1m${match.label}\x1b[22m` +
          (match.year ? theme.fg("muted", `  (${match.year})`) : "") +
          theme.fg("dim", `  — IMDB: ${match.id}`);

        const container = new Container();
        container.addChild(new Text(title_line, 1, 0));
        container.addChild(new Spacer(1));
        container.addChild(image);
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", "Press any key to close"), 1, 0));

        return {
          render: (w: number) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (_data: string) => { done(undefined); },
        };
      });
    },
  });
}
