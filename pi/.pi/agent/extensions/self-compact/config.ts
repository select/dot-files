import { readFileSync } from "node:fs"
import { parseDocument } from "yaml"
import { DEFAULT_SPECS, validateSpecs, type ThresholdSpecs } from "./thresholds.ts"

const KEYS = ["softAt", "at", "buffer"] as const

export interface Config {
	defaults: Partial<ThresholdSpecs>
	models: Record<string, Partial<ThresholdSpecs>>
}

export interface ModelKey {
	provider: string
	id: string
}

function mapping(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a YAML mapping`)
	}
	return value as Record<string, unknown>
}

function limits(value: unknown, label: string): Partial<ThresholdSpecs> {
	const values = mapping(value, label)
	const result: Partial<ThresholdSpecs> = {}
	for (const [key, value] of Object.entries(values)) {
		if (!KEYS.includes(key as (typeof KEYS)[number])) throw new Error(`Unknown key ${label}.${key}`)
		if (typeof value !== "string" && typeof value !== "number") {
			throw new Error(`${label}.${key} must be a token count or percentage`)
		}
		result[key as keyof ThresholdSpecs] = String(value).trim()
	}
	return result
}

export function parseConfig(text: string): Config {
	const document = parseDocument(text, { schema: "core", uniqueKeys: true })
	if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("; "))
	const root = mapping(document.toJS({ maxAliasCount: 100 }), "config")
	for (const key of Object.keys(root)) {
		if (key !== "defaults" && key !== "models") throw new Error(`Unknown config key: ${key}`)
	}
	const defaults = root.defaults === undefined ? {} : limits(root.defaults, "defaults")
	validateSpecs({ ...DEFAULT_SPECS, ...defaults })
	const models: Config["models"] = Object.create(null)
	if (root.models !== undefined) {
		for (const [key, value] of Object.entries(mapping(root.models, "models"))) {
			if (!key.trim() || key !== key.trim()) throw new Error("Model keys must be non-empty and have no surrounding whitespace")
			models[key] = limits(value, `models[${key}]`)
			validateSpecs({ ...DEFAULT_SPECS, ...defaults, ...models[key] })
		}
	}
	return { defaults, models }
}

export function readConfig(path: string): Config {
	try {
		return parseConfig(readFileSync(path, "utf8"))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { defaults: {}, models: {} }
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
	}
}

export function settingsFor(config: Config, model?: ModelKey) {
	const specs = { ...DEFAULT_SPECS }
	const sources: Record<keyof ThresholdSpecs, string> = { softAt: "builtin", at: "builtin", buffer: "builtin" }
	const apply = (values: Partial<ThresholdSpecs> | undefined, source: string) => {
		for (const key of KEYS) {
			if (values?.[key] === undefined) continue
			specs[key] = values[key]
			sources[key] = source
		}
	}
	apply(config.defaults, "defaults")
	if (model) {
		apply(config.models[model.id], `models[${model.id}]`)
		const key = `${model.provider}/${model.id}`
		apply(config.models[key], `models[${key}]`)
	}
	// A bare ID and provider/ID can each be valid alone but invalid after merging.
	validateSpecs(specs)
	return { specs, sources, fromDefaults: Object.values(sources).every(source => source === "builtin") }
}
