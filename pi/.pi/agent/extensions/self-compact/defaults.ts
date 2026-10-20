/** Built-in fallback if ../self-compact.yaml is absent. Configure limits in YAML. */
export interface ThresholdSpecs {
	/** Notice threshold: percentage, whole tokens, or k/m suffix. */
	softAt: string
	/** Ask the agent to compact at this warning threshold. */
	at: string
	/** Allowance after the warning before other tools are blocked. */
	buffer: string
}

export const DEFAULT_SPECS: ThresholdSpecs = { softAt: "30%", at: "50%", buffer: "10%" }

/** Hard cutoff = min(at + buffer, 90% of the selected model's context window). */
export const HARD_CAP_FRACTION = 0.9
