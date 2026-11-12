import type { SelfCompactFooterState } from "../self-compact/footer-state.ts";
import type { RenderedSegment, SegmentContext } from "./types.js";
import { getIcons, hasNerdFonts } from "./icons.js";
import { fg } from "./theme.js";

export type { SelfCompactFooterState };

const STATUSES = ["", "n/a", "NOTICE", "WARNING", "FORCED", "COMPACTING", "COMPACTED", "COMPACTION FAILED", "REJECTED"];

export function readCompactionState(value: unknown): SelfCompactFooterState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Record<string, unknown>;
  const token = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (state.version !== 1 || typeof state.model !== "string" || typeof state.session !== "string" ||
      typeof state.status !== "string" || !STATUSES.includes(state.status) || typeof state.locked !== "boolean" ||
      !token(state.used) || !token(state.notice) || !token(state.warning) || !token(state.forced) ||
      typeof state.cached !== "number" || !Number.isFinite(state.cached) || state.cached < 0) return undefined;
  if (state.forced !== null && (state.forced as number) <= 0) return undefined;
  return value as SelfCompactFooterState;
}

function tokens(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

/** Scale the meter to the configured forced cutoff, not the model's entire window. */
export function renderCompaction(ctx: SegmentContext): RenderedSegment {
  const state = ctx.compaction;
  if (!state) return { content: "", visible: false };
  const width = ctx.availableWidth ?? 120;
  const color = (name: "context" | "contextWarn" | "contextError", text: string) => fg(ctx.theme, name, text, ctx.colors);
  const badges: Record<string, string> = {
    NOTICE: "", WARNING: "SOON", FORCED: "COMPACT",
    COMPACTING: "COMPACTING", COMPACTED: "RESUMING",
    "COMPACTION FAILED": "FAILED", REJECTED: "CONFIG ERROR",
  };
  const badge = badges[state.status];
  const error = state.status === "REJECTED" || state.status === "COMPACTION FAILED" || state.status === "FORCED";
  const warning = state.status === "WARNING";
  const ink = error ? "contextError" : warning ? "contextWarn" : "context";
  const title = getIcons().context || "ctx";
  if (state.forced === null) {
    return { content: color(error ? "contextError" : "context", `${title} ${badge || "limits —"}`), visible: true };
  }
  const numerator = state.used === null ? ctx.theme.fg("dim", tokens(null)) :
    error || warning ? color(ink, tokens(state.used)) :
    ctx.theme.fg(state.status === "NOTICE" ? "accent" : "text", tokens(state.used));
  const budget = numerator + ctx.theme.fg("dim", "/") + ctx.theme.fg("muted", tokens(state.forced));
  // Tiny terminals keep the numerical budget instead of dropping the segment.
  if (width < 30) {
    const mark = badge ? "!" : "";
    const content = width < 16 ? ctx.theme.fg("muted", tokens(state.forced)) + color(ink, mark) :
      budget + color(ink, mark);
    return { content, visible: true };
  }
  const parts = [ctx.theme.fg("muted", title)];

  if (width >= 80) {
    const cells = 8;
    const used = Math.min(cells, Math.floor(Math.max(0, state.used ?? 0) / state.forced * cells));
    const cached = Math.min(used, Math.floor(state.cached / state.forced * cells));
    const unicode = hasNerdFonts() || process.env.POWERLINE_NERD_FONTS !== "0";
    const meter = Array.from({ length: cells }, (_, index) => {
      if (state.used === null) return ctx.theme.fg("dim", unicode ? "▱" : "-");
      if (index >= used) return ctx.theme.fg("dim", unicode ? "▱" : "-");
      return index < cached ? ctx.theme.fg("success", unicode ? "▰" : "=") :
        error || warning ? color(ink, unicode ? "▰" : "=") : ctx.theme.fg("accent", unicode ? "▰" : "=");
    }).join("");
    parts.push(meter);
  }
  parts.push(budget);
  if (badge) {
    const label = state.status === "COMPACTED" ? ctx.theme.fg("success", badge) :
      state.status === "COMPACTING" ? ctx.theme.fg("accent", badge) : color(ink, badge);
    parts.push(ctx.theme.fg("dim", "·"), label);
  } else if (width >= 100 && state.warning !== null) {
    parts.push(ctx.theme.fg("dim", "·"), ctx.theme.fg("dim", `warn ${tokens(state.warning)}`));
  }
  return { content: parts.join(" "), visible: true };
}
