import { test } from "node:test";
import assert from "node:assert/strict";
import { readCompactionState, renderCompaction, type SelfCompactFooterState } from "../compaction.ts";
import { renderSegment } from "../segments.ts";
import { PRESETS } from "../presets.ts";
import type { SegmentContext } from "../types.ts";

const state: SelfCompactFooterState = {
  version: 1, model: "github-copilot/gpt-6-astra", session: "test",
  used: 123000, cached: 80000, notice: 180000, warning: 220000, forced: 250000,
  status: "", locked: false,
};
const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};
const plain = (text: string) => text.replace(/<[^>]+>/g, "").replace(/\x1b\[[0-9;]*m/g, "");
function context(overrides: Partial<SelfCompactFooterState> = {}, width = 120): SegmentContext {
  return {
    model: { id: "gpt-6-astra", contextWindow: 1000000 }, thinkingLevel: "medium",
    sessionId: "test", usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    contextPercent: 12.3, contextWindow: 1000000, autoCompactEnabled: true, sessionStartTime: Date.now(),
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(), options: {}, colors: {},
    theme: theme as SegmentContext["theme"], compaction: { ...state, ...overrides }, availableWidth: width,
  };
}

test("context segment shows usage / forced budget and warning, not model-window percentage", () => {
  const text = renderSegment("context_pct", context()).content;
  assert.match(plain(text), /123k\/250k/);
  assert.match(plain(text), /warn 220k/);
  assert.doesNotMatch(plain(text), /1M|12.3%/);
});

test("meter contains eight cells, with cached, used, and empty colors", () => {
  const text = renderCompaction(context({ used: 156250, cached: 62500 })).content;
  assert.equal((plain(text).match(/[▰▱=\-]/g) ?? []).length, 8);
  assert.match(text, /<success>/);
  assert.match(text, /<accent>/);
  assert.match(text, /<dim>/);
});

test("warnings and hard cutoff use semantic warning/error colors and clear labels", () => {
  const warning = renderCompaction(context({ used: 230000, status: "WARNING" })).content;
  assert.match(plain(warning), /SOON/);
  assert.match(warning, /<warning>/);
  const forced = renderCompaction(context({ used: 260000, status: "FORCED", locked: true })).content;
  assert.match(plain(forced), /COMPACT/);
  assert.match(forced, /<error>/);
  assert.equal((plain(forced).match(/▰/g) ?? []).length, 8);
});

test("handoff, failure, and rejected-config states are visible", () => {
  for (const [status, label] of [["COMPACTING", "COMPACTING"], ["COMPACTED", "RESUMING"], ["COMPACTION FAILED", "FAILED"]]) {
    assert.match(plain(renderCompaction(context({ status })).content), new RegExp(label));
  }
  const rejected = renderCompaction(context({ status: "REJECTED", forced: null })).content;
  assert.match(plain(rejected), /CONFIG ERROR/);
  assert.match(rejected, /<error>/);
});

test("unknown post-compaction usage is not displayed as zero or stale usage", () => {
  const text = plain(renderCompaction(context({ used: null, cached: 0 })).content);
  assert.match(text, /—\/250k/);
  assert.doesNotMatch(text, /123k|0\/250k/);
});

test("narrow terminals omit the meter and secondary threshold but retain active budget and warning state", () => {
  const text = plain(renderCompaction(context({ used: 230000, status: "WARNING" }, 40)).content);
  assert.match(text, /230k\/250k/);
  assert.match(text, /SOON/);
  assert.doesNotMatch(text, /▰|▱|warn/);
  assert.ok(text.length < 30);
});

test("ASCII font override produces ASCII meter cells", () => {
  const previous = process.env.POWERLINE_NERD_FONTS;
  process.env.POWERLINE_NERD_FONTS = "0";
  try {
    const text = plain(renderCompaction(context()).content);
    assert.doesNotMatch(text, /▰|▱/);
    assert.match(text, /[=\-]{8}/);
  } finally {
    if (previous === undefined) delete process.env.POWERLINE_NERD_FONTS;
    else process.env.POWERLINE_NERD_FONTS = previous;
  }
});

test("raw self-compact status is suppressed only while integrated context is available", () => {
  const ctx = context();
  ctx.extensionStatuses = new Map([["self-compact", "[old raw meter]"], ["mcp", "MCP: 3"]]);
  assert.equal(plain(renderSegment("extension_statuses", ctx).content), "MCP: 3");
  ctx.compaction = undefined;
  assert.match(plain(renderSegment("context_pct", ctx).content), /12.3%/);
  ctx.extensionStatuses = new Map([["self-compact", "fallback compact"]]);
  assert.equal(plain(renderSegment("extension_statuses", ctx).content), "fallback compact");
});

test("default order is model, thinking, cache/cost, path, git, context", () => {
  assert.deepEqual(PRESETS.default.leftSegments, [
    "pi", "model", "thinking", "cache_read", "cost", "path", "git", "context_pct",
  ]);
});

test("all existing presets include the integrated context segment", () => {
  for (const preset of Object.values(PRESETS)) {
    assert.ok([...preset.leftSegments, ...preset.rightSegments].includes("context_pct"));
  }
});

test("event payload rejects malformed numbers, statuses, and versions", () => {
  assert.deepEqual(readCompactionState(state), state);
  assert.equal(readCompactionState(null), undefined);
  for (const value of [{ ...state, version: 2 }, { ...state, used: NaN }, { ...state, used: -1 },
    { ...state, forced: 0 }, { ...state, cached: Infinity }, { ...state, status: "unknown" },
    { ...state, session: undefined }]) assert.equal(readCompactionState(value), undefined);
});
