/** Versioned, unstyled UI snapshot shared over Pi's extension event bus. */
export interface SelfCompactFooterState {
	version: 1
	model: string
	session: string
	used: number | null
	cached: number
	notice: number | null
	warning: number | null
	forced: number | null
	status: string
	locked: boolean
}
