import { Palette, lighten, alpha } from "../../lib/wal"

export function hyprlandSettingsCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[4], 0.25)
	const text = p.foreground

	return `
	window.HyprlandSettings {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	.hypr-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.hypr-header {
		margin-bottom: 12px;
	}

	.hypr-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.hypr-section {
		margin-bottom: 16px;
	}

	.hypr-section.last {
		margin-bottom: 0;
	}

	.hypr-list-subtitle {
		font-size: 11px;
		font-weight: 700;
		color: ${alpha(text, 0.6)};
		margin-bottom: 8px;
		letter-spacing: 0.2px;
	}

	.hypr-row-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
		color: ${text};
	}
	.hypr-row-btn:hover {
		background-color: ${segmentSoft};
	}

	.hypr-row-icon {
		font-size: 18px;
		margin-right: 12px;
		color: ${accent};
		min-width: 24px;
	}

	.hypr-row-title {
		font-size: 13px;
		font-weight: 700;
	}

	.hypr-row-desc {
		font-size: 10px;
		color: ${alpha(text, 0.55)};
	}

	.hypr-badge {
		background-color: ${alpha(accent, 0.15)};
		color: ${accent};
		border-radius: 6px;
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 700;
	}

	.hypr-tool-btn {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 12px;
		color: ${text};
	}
	.hypr-tool-btn:hover {
		background-color: ${segmentSoft};
		border-color: ${alpha(accent, 0.35)};
	}

	.hypr-tool-icon {
		font-size: 22px;
		color: ${accent};
		margin-bottom: 4px;
	}

	.hypr-tool-label {
		font-size: 11px;
		font-weight: 700;
	}

	/* GtkSwitch custom thin/rounded design */
	window.HyprlandSettings switch,
	window.HyprlandSettings switch trough,
	window.HyprlandSettings switch slider {
		background-image: none !important;
		box-shadow: none !important;
		border: none !important;
		outline: none !important;
		padding: 0 !important;
		margin: 0 !important;
	}

	window.HyprlandSettings switch {
		background: transparent !important;
		min-width: 36px !important;
		min-height: 20px !important;
	}

	window.HyprlandSettings switch trough {
		background-color: ${alpha(text, 0.2)} !important;
		border-radius: 9999px !important;
		min-height: 8px !important;
		min-width: 36px !important;
		margin: 6px 0 !important;
	}

	window.HyprlandSettings switch:checked trough {
		background-color: ${alpha(accent, 0.45)} !important;
	}

	window.HyprlandSettings switch slider {
		background-color: #d1d1d6 !important;
		border-radius: 9999px !important;
		min-width: 14px !important;
		min-height: 14px !important;
		margin: -3px 0 !important;
		opacity: 0.7 !important;
	}

	window.HyprlandSettings switch:checked slider {
		background-color: ${accent} !important;
		opacity: 1.0 !important;
	}
	`
}
