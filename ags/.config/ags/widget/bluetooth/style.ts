import { Palette, lighten, alpha } from "../../lib/wal"

export function bluetoothCss(p: Palette): string {
	const bg = p.background
	const segmentSoft = lighten(bg, 0.15)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.Bluetooth {
		background: transparent;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
	}

	.bluetooth-box {
		background-color: ${alpha("#000000", 0.85)};
		border: 1px solid ${alpha(text, 0.15)};
		border-radius: 18px;
		padding: 16px;
		min-width: 320px;
		color: ${text};
	}

	.bluetooth-header {
		margin-bottom: 12px;
	}

	.bluetooth-title {
		font-size: 13px;
		font-weight: 800;
		color: ${accent};
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.bluetooth-action-btn, .bluetooth-power-btn {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		padding: 0;
		min-width: 32px;
		min-height: 32px;
		font-size: 14px;
		color: ${text};
		margin-left: 8px;
	}
	.bluetooth-action-btn:hover, .bluetooth-power-btn:hover {
		background-color: ${accent};
		color: ${bg};
	}
	.bluetooth-power-btn.active {
		background-color: ${accent};
		color: ${bg};
	}
	.bluetooth-action-btn.active {
		background-color: ${alpha(accent, 0.15)};
		color: ${accent};
	}

	.bluetooth-section {
		margin-bottom: 12px;
	}

	.bluetooth-section.last {
		margin-bottom: 0;
	}

	.bluetooth-list-subtitle {
		font-size: 11px;
		font-weight: 700;
		color: ${alpha(text, 0.6)};
		margin-bottom: 8px;
		letter-spacing: 0.2px;
	}

	.bluetooth-disabled-box {
		padding: 24px 0;
	}

	.bluetooth-disabled-icon {
		font-size: 32px;
		color: ${alpha(text, 0.3)};
		margin-bottom: 8px;
	}

	.bluetooth-disabled-text {
		font-size: 13px;
		font-weight: 600;
		color: ${alpha(text, 0.55)};
	}

	.bluetooth-scrolled {
		background-color: ${alpha("#000000", 0.4)};
		border: 1px solid ${alpha(text, 0.05)};
		border-radius: 12px;
		padding: 4px;
	}

	.bluetooth-device-list {
		background-color: transparent;
	}

	.bluetooth-device-btn {
		background-color: transparent;
		border-radius: 8px;
		padding: 8px 12px;
		margin: 2px 0;
	}
	.bluetooth-device-btn:hover {
		background-color: ${segmentSoft};
	}
	.bluetooth-device-btn.connected {
		background-color: ${alpha(accent, 0.15)};
	}
	.bluetooth-device-btn.connecting {
		background-color: ${alpha(accent, 0.08)};
	}

	.bluetooth-device-icon {
		font-size: 16px;
		margin-right: 12px;
		color: ${accent};
		min-width: 20px;
	}

	.bluetooth-device-name {
		font-size: 13px;
		font-weight: 600;
		color: ${text};
	}

	.bluetooth-device-status {
		font-size: 10px;
		font-weight: 500;
		color: ${alpha(text, 0.55)};
		margin-top: 2px;
	}

	.bluetooth-device-btn.connected .bluetooth-device-name {
		color: ${accent};
		font-weight: 700;
	}
	.bluetooth-device-btn.connected .bluetooth-device-status {
		color: ${alpha(accent, 0.8)};
	}

	.bluetooth-device-state-icon {
		font-size: 14px;
		color: ${accent};
	}

	.bluetooth-empty-text {
		font-size: 12px;
		font-weight: 500;
		color: ${alpha(text, 0.45)};
	}
	`
}
