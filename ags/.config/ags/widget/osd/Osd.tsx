import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { readFile, monitorFile } from "ags/file"
import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"

const BACKLIGHT = "/sys/class/backlight/intel_backlight"

type Osd = { icon: string; value: number }

const [osd, setOsd] = createState<Osd>({ icon: "󰕾", value: 0 })
const [visible, setVisible] = createState(false)

// Ignore the property/file events that fire while the widgets initialise,
// otherwise the OSD flashes on login.
let primed = false
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
	primed = true
	return GLib.SOURCE_REMOVE
})

let hideTimer = 0
function show(data: Osd) {
	if (!primed) return
	setOsd(data)
	setVisible(true)
	if (hideTimer) GLib.source_remove(hideTimer)
	hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1600, () => {
		setVisible(false)
		hideTimer = 0
		return GLib.SOURCE_REMOVE
	})
}

function volumeGlyph(volume: number, mute: boolean) {
	if (mute || volume <= 0) return "󰖁"
	if (volume < 0.34) return "󰕿"
	if (volume < 0.67) return "󰖀"
	return "󰕾"
}

function brightnessGlyph(value: number) {
	return value < 0.5 ? "󰃞" : "󰃠"
}

// --- volume source (AstalWp) ---
const wp = AstalWp.get_default()
const speaker = wp?.defaultSpeaker
if (speaker) {
	const emit = () => show({ icon: volumeGlyph(speaker.volume, speaker.mute), value: Math.min(1, speaker.volume) })
	speaker.connect("notify::volume", emit)
	speaker.connect("notify::mute", emit)
}

// --- brightness source (sysfs backlight) ---
function readBrightness() {
	const cur = Number(readFile(`${BACKLIGHT}/brightness`).trim())
	const max = Number(readFile(`${BACKLIGHT}/max_brightness`).trim())
	return max > 0 ? cur / max : 0
}
monitorFile(`${BACKLIGHT}/brightness`, () => {
	const value = readBrightness()
	show({ icon: brightnessGlyph(value), value })
})

export default function Osd(gdkmonitor: Gdk.Monitor) {
	const { BOTTOM } = Astal.WindowAnchor

	return (
		<window
			name="osd"
			namespace="ags-osd"
			class="Osd"
			gdkmonitor={gdkmonitor}
			anchor={BOTTOM}
			exclusivity={Astal.Exclusivity.IGNORE}
			layer={Astal.Layer.OVERLAY}
			marginBottom={64}
			application={app}
			visible={visible}
		>
			<revealer
				revealChild={visible}
				transitionType={Gtk.RevealerTransitionType.CROSSFADE}
				transitionDuration={150}
			>
				<box class="osd-box" valign={Gtk.Align.CENTER}>
					<label class="osd-icon" label={osd((o) => o.icon)} />
					<levelbar
						class="osd-bar"
						valign={Gtk.Align.CENTER}
						widthRequest={160}
						value={osd((o) => o.value)}
					/>
				</box>
			</revealer>
		</window>
	)
}
