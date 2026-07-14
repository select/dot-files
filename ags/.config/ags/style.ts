// Generates the global AGS stylesheet from the live wal palette.
import { Palette } from "./lib/wal";
import { barCss } from "./widget/bar/style";
import { trayCss } from "./widget/tray/style";
import { powerMenuCss } from "./widget/powermenu/style";
import { wallpaperCss } from "./widget/wallpaper/style";
import { captureCss } from "./widget/capture/style";
import { osdCss } from "./widget/osd/style";
import { mediaCss } from "./widget/media/style";
import { soundCss } from "./widget/sound/style";
import { bluetoothCss } from "./widget/bluetooth/style";
import { wifiCss } from "./widget/wifi/style";
import { powerCss } from "./widget/power/style";
import { hyprlandSettingsCss } from "./widget/hyprland/style";
import { temperatureCss } from "./widget/temperature/style";
import { soilMoistureCss } from "./widget/soilmoisture/style";

export function css(p: Palette): string {
	return `
	${barCss(p)}
	${powerMenuCss(p)}
	${trayCss(p)}
	${wallpaperCss(p)}
	${captureCss(p)}
	${osdCss(p)}
	${mediaCss(p)}
	${soundCss(p)}
	${bluetoothCss(p)}
	${wifiCss(p)}
	${powerCss(p)}
	${hyprlandSettingsCss(p)}
	${temperatureCss(p)}
	${soilMoistureCss(p)}
	`;
}
