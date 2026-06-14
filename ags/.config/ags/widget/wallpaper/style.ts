// Wallpaper selector stylesheet — kept separate from the bar's style.
// Assembled into the global AGS stylesheet by ../../style.ts.
import { Palette, lighten, alpha } from "../../lib/wal"

export function wallpaperCss(p: Palette): string {
	const bg = p.background
	const segment = lighten(bg, 0.1)
	const segmentSoft = lighten(bg, 0.18)
	const accent = lighten(p.color[5], 0.25)
	const text = p.foreground

	return `
	window.Wallpaper { background: ${alpha("#000000", 0.45)}; }

	.wallpaper-panel {
		background-color: ${alpha(bg, 0.96)};
		border-radius: 18px;
		padding: 16px;
		min-width: 920px;
	}

	.wallpaper-header { margin-bottom: 12px; }

	.wallpaper-search {
		background-color: ${segment};
		color: ${text};
		border: none;
		box-shadow: none;
		border-radius: 9999px;
		padding: 8px 16px;
		margin-right: 8px;
		font-size: 14px;
	}
	.wallpaper-search:focus { background-color: ${segmentSoft}; }

	.wallpaper-random {
		background-color: ${segment};
		color: ${accent};
		border-radius: 9999px;
		padding: 0 14px;
		font-size: 18px;
		min-width: 44px;
	}
	.wallpaper-random:hover { background-color: ${accent}; color: ${bg}; }

	.wallpaper-scroll {
		min-height: 620px;
		min-width: 880px;
	}

	.wallpaper-grid { padding: 2px; }

	.wallpaper-cell {
		padding: 0;
		border-radius: 12px;
		border: 2px solid transparent;
		background: ${segment};
	}
	.wallpaper-cell:hover { border-color: ${accent}; }
	`
}
