// Media player popup (MPRIS via playerctl) stylesheet.
// Mirrors the footer bar: translucent main container + darker pill for buttons.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal";

export function mediaCss(p: Palette): string {
	const segmentSoft = lighten(p.background, 0.18); // button hover, matches bar
	const text = p.foreground;

	return `
	window.Media {
		background: transparent;
		color: ${text};
		font-family: "DejaVuSansM Nerd Font", "Symbols Nerd Font", sans-serif;
		font-size: 13px;
	}
	/* translucent main container, same as the bar's main bg */
	.media-inner {
		background-color: ${alpha("#000000", 0.55)};
		border-radius: 9999px;
		padding: 2px 4px 2px 14px;
		min-height: 28px;
	}
	.media-title { margin-right: 8px; }
	.media-song {
		color: ${text};
		font-size: 12px;
		font-weight: bold;
	}
	.media-artist {
		color: ${alpha(text, 0.6)};
		font-size: 11px;
		margin-left: 8px;
	}
	/* buttons grouped in their own darker pill, like the bar's segments */
	.media-controls {
		background-color: ${alpha("#000000", 0.7)};
		border-radius: 9999px;
		padding: 0 2px;
		margin: 2px 0;
	}
	.media-controls button.media-btn {
		background-color: transparent;
		border: none;
		box-shadow: none;
		border-radius: 9999px;
		padding: 0;
		margin: 0 1px;
		font-size: 13px;
		min-width: 24px;
		min-height: 24px;
	}
	.media-controls button.media-btn.play { font-size: 15px; }
	.media-controls button.media-btn:hover { background-color: ${segmentSoft}; }
	`;
}
