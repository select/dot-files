import { Palette, lighten, alpha } from "../../lib/wal"

export function powerCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.Power {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	.power-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.power-header {
		margin-bottom: 12px;
	}

	.power-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.power-section {
		margin-bottom: 16px;
	}

	.power-section.last {
		margin-bottom: 0;
	}

	.power-list-subtitle {
		font-size: 11px;
		font-weight: 700;
		color: ${alpha(text, 0.6)};
		margin-bottom: 8px;
		letter-spacing: 0.2px;
	}

	.power-scrolled {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 4px;
	}

	.power-device-list {
		background-color: transparent;
	}

	.power-device-row {
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
	}

	.power-device-icon {
		font-size: 18px;
		margin-right: 12px;
		color: ${accent};
		min-width: 24px;
	}

	.power-device-name {
		font-size: 13px;
		font-weight: 700;
	}

	.power-device-status {
		font-size: 10px;
		color: ${alpha(text, 0.55)};
	}

	.power-device-percentage {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
	}

	/* Subtle levelbar style under each device */
	.power-device-bar trough {
		background-color: ${alpha(text, 0.1)};
		border-radius: 9999px;
		min-height: 4px;
	}
	.power-device-bar trough block.filled {
		background-color: ${accent};
		opacity: 0.8;
		border-radius: 9999px;
		min-height: 4px;
	}
	.power-device-bar trough block.empty {
		background-color: transparent;
		min-height: 4px;
	}

	.power-profiles-list {
		background-color: transparent;
	}

	.power-profile-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
		color: ${text};
	}
	.power-profile-btn:hover {
		background-color: ${segmentSoft};
	}
	.power-profile-btn.active {
		background-color: ${alpha(accent, 0.15)};
	}

	.power-profile-icon {
		font-size: 20px;
		margin-right: 12px;
		color: ${accent};
		min-width: 24px;
	}

	.power-profile-title {
		font-size: 13px;
		font-weight: 700;
	}

	.power-profile-desc {
		font-size: 10px;
		color: ${alpha(text, 0.55)};
	}
	`
}
