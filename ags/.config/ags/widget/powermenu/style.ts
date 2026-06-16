import { Palette, lighten, alpha } from "../../lib/wal"

export function powerMenuCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.PowerMenu {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	.powermenu-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.powermenu-header {
		margin-bottom: 12px;
	}

	.powermenu-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.powermenu-section {
		margin-bottom: 12px;
	}

	.powermenu-section.last {
		margin-bottom: 0;
	}

	.powermenu-list {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 4px;
	}

	.powermenu-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
	}
	.powermenu-btn:hover {
		background-color: ${segmentSoft};
	}

	.powermenu-btn-icon {
		font-size: 16px;
		margin-right: 12px;
		color: ${accent};
		min-width: 20px;
	}

	.powermenu-btn-title {
		font-size: 13px;
		font-weight: 600;
		color: ${text};
	}

	.powermenu-btn-desc {
		font-size: 10px;
		font-weight: 500;
		color: ${alpha(text, 0.55)};
		margin-top: 2px;
	}
	`
}
