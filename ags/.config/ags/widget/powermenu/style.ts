// Power menu popup stylesheet — kept separate from the global style.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten } from "../../lib/wal";

export function powerMenuCss(p: Palette): string {
	const bg = p.background;
	const segment = lighten(bg, 0.1);
	const segmentSoft = lighten(bg, 0.18);
	const accent = lighten(p.color[5], 0.25);

	return `
	window.PowerMenu { background: transparent; }
	.powermenu-box {
		background-color: ${segment};
		border-radius: 9999px;
		padding: 6px;
	}
	.powermenu-box button {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		padding: 6px;
		margin: 4px;
		font-size: 18px;
		min-width: 38px;
		min-height: 38px;
	}
	.powermenu-box button:hover { background-color: ${accent}; color: ${bg}; }
	`;
}
