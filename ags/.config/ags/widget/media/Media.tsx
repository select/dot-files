import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createBinding } from "ags"
import { createPoll } from "ags/time"
import { execAsync } from "ags/process"
import Pango from "gi://Pango"
import AstalTray from "gi://AstalTray"

type Media = { active: boolean; playing: boolean; title: string; artist: string }

const EMPTY: Media = { active: false, playing: false, title: "", artist: "" }

// Symmetric padding kept between the media widget and its neighbours
// (bar right end / tray left end) so it sits centered in the gap.
const GAP_PADDING = 8

function ctl(...args: string[]) {
	execAsync(["playerctl", ...args]).catch(() => {})
}

export default function Media(gdkmonitor: Gdk.Monitor) {
	const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	const media = createPoll<Media>(EMPTY, 1000, () =>
		execAsync(["bash", "-c", "playerctl metadata --format '{{status}}\t{{title}}\t{{artist}}' 2>/dev/null"])
			.then((out) => {
				const [status, title, artist] = out.trim().split("\t")
				if (!status) return EMPTY
				return {
					active: status === "Playing" || status === "Paused",
					playing: status === "Playing",
					title: title || "Unknown",
					artist: artist || "",
				}
			})
			.catch(() => EMPTY),
	)

	// --- dynamic geometry ---------------------------------------------------
	// The bar is centered with width 0.36*M, so its visible pill's right edge
	// is at 0.5*M + 0.5*barWidth (mirroring Bar.tsx). The tray sits at the
	// right edge (marginRight 6); its width tracks the number of status-notifier
	// items (~28px each + 16px inner padding).
	//
	// The media window is anchored LEFT|RIGHT so it is hard-locked to exactly
	// the width between marginLeft (= bar pill right edge + padding) and
	// marginRight (= tray footprint + padding). A both-edges anchor is a real
	// width cap (unlike widthRequest, which is only a minimum), so the title is
	// forced to ellipsize and can never overlap the bar or tray — even when the
	// title is long or the screen is scaled.
	const monitorWidth = gdkmonitor.get_geometry().width || 1920
	const barWidth = Math.round(monitorWidth * 0.36)
	const barRightEdge = monitorWidth * 0.5 + barWidth * 0.5

	const tray = AstalTray.get_default()
	const trayItems = createBinding(tray, "items")
	// full footprint the tray occupies from the right screen edge:
	// marginRight(6) + inner padding(16) + 28px per item
	const trayFootprint = trayItems((items) =>
		items.length > 0 ? 6 + 16 + items.length * 28 : 0,
	)

	const marginLeft = barRightEdge + GAP_PADDING
	const marginRight = trayFootprint((f) => f + GAP_PADDING)

	return (
		<window
			name="media"
			namespace="ags-media"
			class="Media"
			gdkmonitor={gdkmonitor}
			anchor={BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			layer={Astal.Layer.TOP}
			marginBottom={4}
			marginLeft={marginLeft}
			marginRight={marginRight}
			application={app}
			visible={media((m) => m.active)}
		>
			<box class="media-gap" valign={Gtk.Align.CENTER} hexpand>
				<box class="media-inner" valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER}>
					<box class="media-title" hexpand valign={Gtk.Align.CENTER}>
						<label
							class="media-song"
							halign={Gtk.Align.START}
							hexpand
							ellipsize={Pango.EllipsizeMode.END}
							label={media((m) => m.title)}
						/>
						<label
							class="media-artist"
							halign={Gtk.Align.START}
							visible={media((m) => m.artist.length > 0)}
							ellipsize={Pango.EllipsizeMode.END}
							label={media((m) => m.artist)}
						/>
					</box>
					<box class="media-controls" halign={Gtk.Align.END} valign={Gtk.Align.CENTER}>
						<button class="media-btn" tooltipText="Previous" onClicked={() => ctl("previous")}>
							<label label="󰒮" />
						</button>
						<button class="media-btn play" tooltipText="Play / pause" onClicked={() => ctl("play-pause")}>
							<label label={media((m) => (m.playing ? "󰏤" : "󰐊"))} />
						</button>
						<button class="media-btn" tooltipText="Next" onClicked={() => ctl("next")}>
							<label label="󰒭" />
						</button>
					</box>
				</box>
			</box>
		</window>
	)
}
