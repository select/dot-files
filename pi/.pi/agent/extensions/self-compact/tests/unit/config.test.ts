import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseConfig, readConfig, settingsFor } from "../../config.ts"
import { DEFAULT_SPECS, resolveThresholds } from "../../thresholds.ts"

test("global YAML defaults apply to every model", () => {
	const config = parseConfig('defaults: { softAt: "30%", at: "50%", buffer: "10%" }')
	for (const model of [undefined, { provider: "a", id: "one" }, { provider: "b", id: "two" }]) {
		const result = settingsFor(config, model)
		assert.deepEqual(result.specs, { softAt: "30%", at: "50%", buffer: "10%" })
		assert.deepEqual(result.sources, { softAt: "defaults", at: "defaults", buffer: "defaults" })
		assert.equal(result.fromDefaults, false)
	}
})

test("model ID and provider/model overrides merge per field, including slashes in IDs", () => {
	const config = parseConfig(`
defaults: { softAt: "20%", at: "50%", buffer: "10%" }
models:
  vendor/model: { at: "40%", buffer: "5%" }
  provider/vendor/model: { at: "45%" }
`)
	const result = settingsFor(config, { provider: "provider", id: "vendor/model" })
	assert.deepEqual(result.specs, { softAt: "20%", at: "45%", buffer: "5%" })
	assert.deepEqual(result.sources, { softAt: "defaults", at: "models[provider/vendor/model]", buffer: "models[vendor/model]" })
	assert.equal(settingsFor(config, { provider: "other", id: "vendor/model" }).specs.at, "40%")
	assert.equal(settingsFor(config, { provider: "provider", id: "different" }).specs.at, "50%")
})

test("numeric tokens, k/m suffixes, percentages, and zero buffer work", () => {
	const config = parseConfig('defaults: { softAt: 60000, at: 100k, buffer: 0 }')
	const result = settingsFor(config)
	assert.deepEqual(result.specs, { softAt: "60000", at: "100k", buffer: "0" })
	const resolved = resolveThresholds(result.specs, 200000)
	assert.equal(resolved.ok, true)
	if (resolved.ok) assert.equal(resolved.thresholds.forcedTokens, 100000)
	assert.doesNotThrow(() => parseConfig('defaults: { softAt: 100k, at: 1.5m }'))
})

test("omitted YAML sections and missing files use built-ins", () => {
	assert.deepEqual(settingsFor(parseConfig("{}")).specs, DEFAULT_SPECS)
	assert.equal(settingsFor(parseConfig("{}")).fromDefaults, true)
	const root = mkdtempSync(join(tmpdir(), "sc-config-"))
	assert.deepEqual(settingsFor(readConfig(join(root, "missing.yaml"))).specs, DEFAULT_SPECS)
})

test("unknown keys, wrong shapes/types, duplicate keys, malformed YAML, and bad limits are rejected", () => {
	for (const text of [
		"", "[]", "null", "defaults: null", "defaults: []", "models: []",
		"extra: true", "defaults: { warning: 50% }", "defaults: { at: true }",
		"defaults: { at: null }", 'defaults: { at: "" }', "defaults: { at: -1 }",
		"defaults: { at: 95% }", "defaults: { softAt: 60%, at: 50% }",
		"defaults: { at: 50%, at: 40% }", "models: { one: { nope: 0 } }",
		"models: { one: { at: 5% } }", 'models: { "": {} }', "defaults: [",
	]) assert.throws(() => parseConfig(text), Error, JSON.stringify(text))
})

test("combined model selectors are validated after merging", () => {
	const config = parseConfig(`
defaults: { softAt: "10%", at: "50%" }
models:
  model: { softAt: "40%" }
  provider/model: { at: "30%" }
`)
	assert.throws(() => settingsFor(config, { provider: "provider", id: "model" }), /must not exceed/)
})

test("explicit token limits cannot exceed the selected model's window", () => {
	const settings = settingsFor(parseConfig("defaults: { softAt: 60k, at: 100k }"))
	assert.equal(resolveThresholds(settings.specs, 100000, settings).ok, false)
	const capped = resolveThresholds({ softAt: "30%", at: "85%", buffer: "10%" }, 100000)
	assert.equal(capped.ok, true)
	if (capped.ok) assert.equal(capped.thresholds.forcedTokens, 90000)
})

test("readConfig rereads edits and reports paths for malformed files", () => {
	const root = mkdtempSync(join(tmpdir(), "sc-config-"))
	const path = join(root, "config.yaml")
	writeFileSync(path, "defaults: { at: 40% }")
	assert.equal(settingsFor(readConfig(path)).specs.at, "40%")
	writeFileSync(path, "defaults: { at: 60% }")
	assert.equal(settingsFor(readConfig(path)).specs.at, "60%")
	writeFileSync(path, "defaults: [")
	assert.throws(() => readConfig(path), error => error instanceof Error && error.message.includes(path))
})

test("repository YAML cuts configured GPT models at the pricing boundary or context cap", () => {
	const config = readConfig(new URL("../../../self-compact.yaml", import.meta.url).pathname)
	for (const model of [
		undefined,
		{ provider: "github-copilot", id: "gpt-6.1-sol" },
		{ provider: "github-copilot", id: "gpt-6-astra" },
		{ provider: "github-copilot", id: "gpt-6-luna" },
		{ provider: "amazon-bedrock", id: "eu.anthropic.claude-opus-5-5" },
		{ provider: "amazon-bedrock", id: "eu.anthropic.claude-sonnet-5" },
		{ provider: "vertex-global", id: "gemini-3.8-flash" },
		{ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash:nitro" },
	]) {
		const settings = settingsFor(config, model)
		const gpt = model?.provider === "github-copilot"
		for (const window of gpt ? [300000, 1000000] : [500000, 1000000]) {
			const result = resolveThresholds(settings.specs, window)
			assert.equal(result.ok, true)
			if (result.ok) {
				assert.equal(result.thresholds.softTokens, gpt ? 180000 : 200000)
				assert.equal(result.thresholds.warnTokens, gpt ? 250000 : 300000)
				assert.equal(result.thresholds.forcedTokens, gpt ? Math.min(272000, Math.floor(window * 0.9)) : 350000)
				if (gpt) assert.ok(result.thresholds.forcedTokens <= 272000)
			}
		}
	}
})
