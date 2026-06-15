import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createPoll } from "ags/time"
import { execAsync } from "ags/process"
import Pango from "gi://Pango"

type Media = { active: boolean; playing: boolean; title: string; artist: string }

const EMPTY: Media = { active: false, playing: false, title: "", artist: "" }

function ctl(...args: string[]) {
	execAsync(["playerctl", ...args]).catch(() => {})
}

export default function Media(gdkmonitor: Gdk.Monitor) {
	const { BOTTOM, RIGHT } = Astal.WindowAnchor

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

	return (
		<window
			name="media"
			namespace="ags-media"
			class="Media"
			gdkmonitor={gdkmonitor}
			anchor={BOTTOM | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			layer={Astal.Layer.TOP}
			marginBottom={4}
			marginRight={145}
			application={app}
			visible={media((m) => m.active)}
		>
			<box class="media-inner" valign={Gtk.Align.CENTER}>
				<box class="media-title" valign={Gtk.Align.CENTER}>
					<label
						class="media-song"
						halign={Gtk.Align.START}
						ellipsize={Pango.EllipsizeMode.END}
						maxWidthChars={22}
						label={media((m) => m.title)}
					/>
					<label
						class="media-artist"
						halign={Gtk.Align.START}
						visible={media((m) => m.artist.length > 0)}
						ellipsize={Pango.EllipsizeMode.END}
						maxWidthChars={16}
						label={media((m) => m.artist)}
					/>
				</box>
				<box class="media-controls" valign={Gtk.Align.CENTER}>
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
		</window>
	)
}
