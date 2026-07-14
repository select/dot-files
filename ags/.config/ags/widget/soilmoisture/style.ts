import { Palette, alpha, lighten } from "../../lib/wal";

export function soilMoistureCss(p: Palette): string {
	const text = p.foreground;
	// Same slot → color mapping used by the line graph in SoilMoisture.tsx.
	const slotColors = [p.color[3], p.color[5], p.color[2], p.color[4], p.color[1], p.color[0]];

	const badgeCss = slotColors
		.map(
			(c, i) => `
	.soil-badge-${i} {
		background-color: ${alpha(c, 0.15)};
		color: ${lighten(c, 0.1)};
	}`,
		)
		.join("");

	return `
	window.SoilMoisture {
		background: transparent;
	}

	.soil-container {
		background-color: ${alpha("#000000", 0.25)};
		border: 1px solid ${alpha(p.foreground, 0.05)};
		border-radius: 16px;
		padding: 16px;
		margin: 0;
	}

	.soil-title {
		color: ${text};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 14px;
		font-weight: bold;
	}

	.soil-badge {
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		border-radius: 6px;
		padding: 2px 8px;
		font-weight: bold;
		font-size: 12px;
	}
	${badgeCss}

	.soil-drawing-area {
		margin-top: 12px;
		margin-bottom: 8px;
	}

	.soil-footer-label {
		color: ${alpha(text, 0.4)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}

	/* --- configuration error state --- */
	.soil-error {
		margin-top: 12px;
		padding: 10px 12px;
		border-radius: 10px;
		background-color: ${alpha("#e53935", 0.12)};
		border: 1px solid ${alpha("#e53935", 0.35)};
	}
	.soil-error-title {
		color: #ff6b6b;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 12px;
		font-weight: bold;
	}
	.soil-error-hint {
		color: ${alpha(text, 0.7)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}
	.soil-error-key {
		color: ${text};
		font-family: "DejaVuSansMono Nerd Font", monospace;
		font-size: 11px;
		font-weight: bold;
	}
	.soil-error-desc {
		color: ${alpha(text, 0.55)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}
	`;
}
