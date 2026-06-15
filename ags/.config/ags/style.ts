// Generates the global AGS stylesheet from the live wal palette.
import { Palette } from "./lib/wal";
import { barCss } from "./widget/bar/style";
import { trayCss } from "./widget/tray/style";
import { powerMenuCss } from "./widget/powermenu/style";
import { wallpaperCss } from "./widget/wallpaper/style";
import { captureCss } from "./widget/capture/style";
import { osdCss } from "./widget/osd/style";
import { mediaCss } from "./widget/media/style";

export function css(p: Palette): string {
	return `
	${barCss(p)}
	${powerMenuCss(p)}
	${trayCss(p)}
	${wallpaperCss(p)}
	${captureCss(p)}
	${osdCss(p)}
	${mediaCss(p)}
	`;
}
