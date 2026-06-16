import { Palette, lighten, alpha } from "../../lib/wal"

export function wifiCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.Wifi {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	.wifi-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.wifi-header {
		margin-bottom: 12px;
	}

	.wifi-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.wifi-action-btn, .wifi-power-btn {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		padding: 0;
		min-width: 32px;
		min-height: 32px;
		font-size: 14px;
		color: ${text};
		margin-left: 8px;
	}
	.wifi-action-btn:hover, .wifi-power-btn:hover {
		background-color: ${accent};
		color: ${bg};
	}
	.wifi-power-btn.active {
		background-color: ${accent};
		color: ${bg};
	}
	.wifi-action-btn.active {
		background-color: ${alpha(accent, 0.15)};
		color: ${accent};
	}

	.wifi-section {
		margin-bottom: 12px;
	}

	.wifi-section.last {
		margin-bottom: 0;
	}

	.wifi-list-subtitle {
		font-size: 11px;
		font-weight: 700;
		color: ${alpha(text, 0.6)};
		margin-bottom: 8px;
		letter-spacing: 0.2px;
	}

	.wifi-disabled-box {
		padding: 24px 0;
	}

	.wifi-disabled-icon {
		font-size: 32px;
		color: ${alpha(text, 0.3)};
		margin-bottom: 8px;
	}

	.wifi-disabled-text {
		font-size: 13px;
		font-weight: 600;
		color: ${alpha(text, 0.55)};
	}

	.wifi-scrolled {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 4px;
	}

	.wifi-network-list {
		background-color: transparent;
	}

	.wifi-network-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
	}
	.wifi-network-btn:hover {
		background-color: ${segmentSoft};
	}
	.wifi-network-btn.active {
		background-color: ${alpha(accent, 0.15)};
	}

	.wifi-network-icon {
		font-size: 16px;
		margin-right: 12px;
		color: ${accent};
		min-width: 20px;
	}

	.wifi-network-name {
		font-size: 13px;
		font-weight: 600;
		color: ${text};
	}

	.wifi-network-status {
		font-size: 10px;
		font-weight: 500;
		color: ${alpha(text, 0.55)};
		margin-top: 2px;
	}

	.wifi-network-btn.active .wifi-network-name {
		color: ${accent};
		font-weight: 700;
	}
	.wifi-network-btn.active .wifi-network-status {
		color: ${alpha(accent, 0.8)};
	}

	.wifi-network-lock-icon {
		font-size: 12px;
		color: ${alpha(text, 0.45)};
	}

	.wifi-network-state-icon {
		font-size: 14px;
		color: ${accent};
	}

	.wifi-empty-text {
		font-size: 12px;
		font-weight: 500;
		color: ${alpha(text, 0.45)};
	}
	`
}
