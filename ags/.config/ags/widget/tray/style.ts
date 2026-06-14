// System tray stylesheet — kept separate from the global style.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal";

export function trayCss(p: Palette): string {
	const bg = p.background;
	const segmentSoft = lighten(bg, 0.18);

	return `
	window.Tray { background: transparent; }
	.tray-inner {
		background-color: ${alpha("#000000", 0.7)};
		border-radius: 9999px;
		padding: 2px 8px;
		min-height: 28px;
	}
	.tray-item {
		background: transparent;
		border: none;
		box-shadow: none;
		border-radius: 9999px;
		padding: 0;
		min-width: 28px;
		min-height: 28px;
	}
	.tray-item > button {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		min-height: 0;
	}
	.tray-item:hover { background-color: ${segmentSoft}; }
	`;
}
