// Screenshot / screen-record selector stylesheet — modeled on Ubuntu's
// GNOME screenshot UI. Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal";

export function captureCss(p: Palette): string {
	const bg = p.background;
	const segment = lighten(bg, 0.1);
	const segmentSoft = lighten(bg, 0.18);
	const accent = lighten(p.color[5], 0.25);
	const text = p.foreground;

	return `
	window.Capture { background: ${alpha("#000000", 0.45)}; }

	.capture-panel {
		background-color: ${alpha(bg, 0.96)};
		border-radius: 22px;
		padding: 18px;
		min-width: 380px;
	}

	/* mode cards: Selection / Screen / Window */
	.capture-modes { margin-bottom: 18px; }
	.capture-mode {
		background: transparent;
		border: none;
		box-shadow: none;
		border-radius: 12px;
		padding: 10px 8px;
		color: ${text};
		opacity: 0.45;
	}
	.capture-mode:hover { opacity: 0.8; background-color: ${alpha(segment, 0.5)}; }
	.capture-mode.active { opacity: 1; }
	.capture-mode-icon { font-size: 40px; color: ${text}; }
	.capture-mode-label { font-size: 12px; text-align: center; color: ${text}; }
	.capture-mode.active .capture-mode-icon,
	.capture-mode.active .capture-mode-label { color: ${accent}; }

	/* bottom row: kind toggle + shutter */
	.capture-bottom { }

	.capture-kind {
		background-color: ${segment};
		border-radius: 9999px;
		padding: 3px;
		min-width: 84px;
	}
	.capture-kind-btn {
		background: transparent;
		color: ${text};
		border-radius: 9999px;
		padding: 4px 10px;
		min-width: 36px;
		font-size: 15px;
		opacity: 0.65;
	}
	.capture-kind-btn:hover { opacity: 1; }
	.capture-kind-btn.active {
		background-color: ${segmentSoft};
		color: ${accent};
		opacity: 1;
	}

	/* shutter button — white ring with inner disc, like GNOME's */
	.capture-shutter {
		background: transparent;
		border: 3px solid ${text};
		border-radius: 9999px;
		padding: 0;
	}
	.capture-shutter:hover { border-color: ${accent}; }
	.capture-shutter-inner {
		background-color: ${text};
		border-radius: 9999px;
	}
	.capture-shutter:hover .capture-shutter-inner { background-color: ${accent}; }
	.capture-shutter.recording { border-color: #e53935; }
	.capture-shutter.recording .capture-shutter-inner {
		background-color: #e53935;
		border-radius: 9999px;
	}
	`;
}
