// Sound configuration widget stylesheet.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal"

export function soundCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.Sound {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	button.sound-backdrop {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		margin: 0;
	}
	button.sound-backdrop:hover {
		background: transparent;
	}

	.sound-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.sound-section {
		margin-bottom: 12px;
	}

	.sound-section.last {
		margin-bottom: 0;
	}

	.sound-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		margin-bottom: 10px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.sound-slider-row {
		margin-bottom: 12px;
	}

	.sound-mute-btn {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		padding: 0;
		min-width: 32px;
		min-height: 32px;
		font-size: 14px;
		color: ${text};
	}
	.sound-mute-btn:hover {
		background-color: ${accent};
		color: ${bg};
	}
	.sound-mute-btn.muted {
		background-color: ${alpha("#e53935", 0.2)};
		color: #ff5252;
	}
	.sound-mute-btn.muted:hover {
		background-color: #e53935;
		color: #ffffff;
	}

	.sound-scale {
		margin: 0 10px;
	}

	/* GTK4 Scale styling for the sliders */
	.sound-scale trough {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		min-height: 6px;
	}
	.sound-scale highlight {
		background-color: ${accent};
		border-radius: 9999px;
	}
	.sound-scale slider {
		background-color: ${text};
		border-radius: 9999px;
		min-width: 14px;
		min-height: 14px;
		margin: -4px 0;
	}

	.sound-percentage {
		font-size: 12px;
		font-weight: 700;
		min-width: 36px;
	}

	.sound-device-list {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 4px;
	}

	.sound-device-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 6px 12px;
		margin: 2px 0;
	}
	.sound-device-btn:hover {
		background-color: ${segmentSoft};
	}
	.sound-device-btn.active {
		background-color: ${alpha(accent, 0.15)};
		color: ${accent};
		font-weight: 700;
	}

	.sound-device-icon {
		font-size: 13px;
		margin-right: 8px;
		color: ${accent};
	}

	.sound-device-name {
		font-size: 12px;
		font-weight: 500;
	}

	.sound-separator {
		background-color: ${alpha(text, 0.1)};
		min-height: 1px;
		margin: 14px 0;
	}
	`
}
