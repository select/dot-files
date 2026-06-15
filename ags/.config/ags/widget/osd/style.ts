// On-screen display popup (volume / brightness) stylesheet.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal";

export function osdCss(p: Palette): string {
	const bg = p.background;
	const segment = lighten(bg, 0.1);
	const trough = lighten(bg, 0.18);
	const accent = lighten(p.color[5], 0.25);

	return `
	window.Osd { background: transparent; }
	.osd-box {
		background-color: ${alpha(segment, 0.95)};
		border-radius: 9999px;
		padding: 10px 18px;
		margin: 4px;
	}
	.osd-icon {
		font-size: 20px;
		color: ${p.foreground};
		margin-right: 12px;
		min-width: 24px;
	}
	.osd-bar trough {
		background-color: ${trough};
		border-radius: 9999px;
		min-height: 8px;
	}
	.osd-bar trough block.filled {
		background-color: ${accent};
		border-radius: 9999px;
		min-height: 8px;
	}
	.osd-bar trough block.empty {
		background-color: transparent;
		min-height: 8px;
	}
	`;
}
