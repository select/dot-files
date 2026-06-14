// Generates the bar stylesheet from the live wal palette.
import { Palette, lighten, darken, alpha } from "./lib/wal";

export function css(p: Palette): string {
	const bg = p.background;
	const segment = lighten(bg, 0.1); // bar segment background (dark slate)
	const segmentSoft = lighten(bg, 0.18); // inner pill / hover
	const accent = lighten(p.color[5], 0.25); // active workspace + logo (bright)
	const text = p.foreground;
	const muted = lighten(p.color[8], 0.15);

	// per-icon colors pulled from the wal palette, lightened so they pop on the dark bar
	const start = lighten(p.color[1], 0.25); // active workspace + logo (bright)
	const icon = (c: string) => lighten(c, 0.16);
	const mic = muted;
	const volume = icon(p.color[5]);
	const bluetooth = icon(p.color[5]);
	const wifi = icon(p.color[6]);
	const battery = icon(p.color[4]);
	const messages = icon(p.color[2]);
	const power = icon(p.color[6]);

	return `
	window.Bar {
		background: transparent;
		color: ${text};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 13px;
	}

	.bar-inner {
		background-color: ${alpha("#000000", 0.55)};
		border-radius: 18px;
		padding: 0;
	}

	/* start (logo+workspaces) and end (status icons) boxes */
	.segment {
		background-color: ${alpha("#000000", 0.7)};
		border-radius: 9999px;
		padding: 2px 8px;
		margin: 0;
	}



	/* logo / power trigger */
	.logo {
		background: transparent;
		border-radius: 9999px;
		padding: 2px 6px;
		margin: 0;
		color: ${start};
		font-size: 15px;
	}
	.logo:hover { background-color: ${segmentSoft}; }

	/* workspace switcher */
	.workspaces { padding: 0 2px; }
	.ws {
		background-color: ${lighten(bg, 0.32)};
		border-radius: 9999px;
		min-width: 13px;
		min-height: 13px;
		margin: 0 3px;
		padding: 0;
	}
	.ws:hover { background-color: ${lighten(bg, 0.45)}; }
	.ws.active {
		background-color: ${accent};
		min-width: 30px;
	}

	/* center clock (no background) */
	.clock {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0 16px;
		color: ${text};
		font-weight: 600;
		letter-spacing: 1px;
	}
	.clock:hover { background-color: ${segmentSoft}; border-radius: 9999px; }

	/* right side status icons */
	.status { padding: 0 2px; }
	.status button {
		background: transparent;
		border-radius: 9999px;
		padding: 2px 6px;
		margin: 0 1px;
		font-size: 14px;
	}
	.status button:hover { background-color: ${segmentSoft}; }

	.icon-mic { color: ${mic}; }
	.icon-mic.recording {
		color: #ffffff;
		background-color: #e53935;
		border-radius: 9999px;
		padding: 0;
		min-width: 26px;
		min-height: 26px;
		margin: 0 2px;
	}
	.icon-volume { color: ${volume}; }
	.icon-bluetooth { color: ${bluetooth}; }
	.icon-wifi { color: ${wifi}; }
	.icon-battery { color: ${battery}; }
	.icon-messages { color: ${messages}; }
	.icon-power { color: ${power}; }

	.icon-keyboard { color: ${text}; }
	.kbd-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; opacity: 0.8; }

	.badge {
		color: ${messages};
		font-size: 11px;
		font-weight: 700;
		margin-left: 1px;
	}

	/* power menu popup */
	window.PowerMenu { background: transparent; }
	.powermenu-box {
		background-color: ${segment};
		border-radius: 9999px;
		padding: 6px;
	}
	.powermenu-box button {
		background-color: ${segmentSoft};
		border-radius: 9999px;
		padding: 6px;
		margin: 4px;
		font-size: 18px;
		min-width: 38px;
		min-height: 38px;
	}
	.powermenu-box button:hover { background-color: ${accent}; color: ${bg}; }

	/* system tray (bottom-right corner, matches bar segments) */
	window.Tray { background: transparent; }
	.tray-inner {
		background-color: ${alpha("#000000", 0.7)};
		border-radius: 9999px;
		padding: 2px 8px;
		min-height: 28px;
	}
	.tray-item {
		background: transparent;
		border: none;
		box-shadow: none;
		border-radius: 9999px;
		padding: 2px 4px;
		margin: 0 1px;
		min-height: 0;
	}
	.tray-item > button {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		min-height: 0;
	}
	.tray-item:hover { background-color: ${segmentSoft}; }
	`;
}
