import { Palette, alpha, lighten } from "../../lib/wal";

export function temperatureCss(p: Palette): string {
	const bg = p.background;
	const text = p.foreground;
	const insideColor = p.color[3];
	const outsideColor = p.color[5];

	return `
	window.Temperature {
		background: transparent;
	}

	.temp-container {
		background-color: ${alpha("#000000", 0.25)};
		border: 1px solid ${alpha(p.foreground, 0.05)};
		border-radius: 16px;
		padding: 16px;
		margin: 0;
	}

	.temp-title {
		color: ${text};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 14px;
		font-weight: bold;
	}

	.temp-inside-badge {
		background-color: ${alpha(insideColor, 0.15)};
		color: ${lighten(insideColor, 0.1)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		border-radius: 6px;
		padding: 2px 8px;
		font-weight: bold;
		font-size: 12px;
	}

	.temp-outside-badge {
		background-color: ${alpha(outsideColor, 0.15)};
		color: ${lighten(outsideColor, 0.15)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		border-radius: 6px;
		padding: 2px 8px;
		font-weight: bold;
		font-size: 12px;
	}

	.temp-drawing-area {
		margin-top: 12px;
		margin-bottom: 8px;
	}

	.temp-footer-label {
		color: ${alpha(text, 0.4)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}

	/* --- configuration error state --- */
	.temp-error {
		margin-top: 12px;
		padding: 10px 12px;
		border-radius: 10px;
		background-color: ${alpha("#e53935", 0.12)};
		border: 1px solid ${alpha("#e53935", 0.35)};
	}
	.temp-error-title {
		color: #ff6b6b;
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 12px;
		font-weight: bold;
	}
	.temp-error-hint {
		color: ${alpha(text, 0.7)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}
	.temp-error-key {
		color: ${text};
		font-family: "DejaVuSansMono Nerd Font", monospace;
		font-size: 11px;
		font-weight: bold;
	}
	.temp-error-desc {
		color: ${alpha(text, 0.55)};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 10px;
	}
	`;
}
