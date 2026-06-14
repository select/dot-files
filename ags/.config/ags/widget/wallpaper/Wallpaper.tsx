import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState } from "ags"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

const HOME = GLib.get_home_dir()
const DIR = `${HOME}/Pictures/Wallpaper`
const SCRIPT = `${HOME}/.config/hypr/scripts/wallpaper.sh`

type Wall = { path: string; name: string }

// List wallpapers once at load. Cheap synchronous dir scan via GLib.
// The folder often holds both an image and a .webp copy of the same picture,
// but GdkPixbuf has no webp loader here (they render blank), so only take
// png/jpg and dedupe by basename (prefer png > jpg).
function load(): Wall[] {
	const rank: Record<string, number> = { png: 3, jpg: 2, jpeg: 2 }
	const best = new Map<string, { path: string; ext: string }>()
	try {
		const dir = GLib.Dir.open(DIR, 0)
		let n: string | null
		while ((n = dir.read_name()) !== null) {
			const m = n.match(/\.(jpe?g|png)$/i)
			if (!m) continue
			const ext = m[1].toLowerCase()
			const name = n.replace(/\.[^.]+$/, "")
			const cur = best.get(name)
			if (!cur || rank[ext] > rank[cur.ext]) best.set(name, { path: `${DIR}/${n}`, ext })
		}
		dir.close()
	} catch (err) {
		console.error(err)
	}
	return Array.from(best, ([name, v]) => ({ name, path: v.path })).sort((a, b) => a.name.localeCompare(b.name))
}

const walls = load()
const [query, setQuery] = createState("")

// metadata lookup for the FlowBox filter (keyed by the cell button widget)
const meta = new WeakMap<Gtk.Widget, Wall>()

function close() {
	app.get_window("wallpaper")?.set_visible(false)
}

function select(path: string) {
	close()
	execAsync([SCRIPT, path]).catch((err) => console.error(err))
}

function random() {
	close()
	execAsync([SCRIPT, "random"]).catch((err) => console.error(err))
}

export default function Wallpaper(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	let entry: Gtk.Entry
	let flow: Gtk.FlowBox

	const filter = (child: Gtk.FlowBoxChild) => {
		const q = query.get().trim().toLowerCase()
		if (!q) return true
		const w = meta.get(child.get_child()!)
		return w ? w.name.toLowerCase().includes(q) : true
	}

	return (
		<window
			name="wallpaper"
			namespace="wallpaper"
			class="Wallpaper"
			gdkmonitor={gdkmonitor}
			anchor={TOP | BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			keymode={Astal.Keymode.ON_DEMAND}
			layer={Astal.Layer.OVERLAY}
			application={app}
			visible={false}
			$={(self) =>
				self.connect("notify::visible", () => {
					if (!self.visible) return
					// reset + focus the search field each time it opens
					setQuery("")
					entry.set_text("")
					flow.invalidate_filter()
					entry.grab_focus()
				})
			}
		>
			<Gtk.EventControllerKey
				onKeyPressed={({}, keyval: number) => {
					if (keyval === Gdk.KEY_Escape) close()
				}}
			/>
			{/* full-screen catcher: click outside the panel to close (on release so
			    inner buttons claim the sequence first — see PowerMenu) */}
			<box>
				<Gtk.GestureClick onReleased={() => close()} />
				<box
					class="wallpaper-panel"
					orientation={Gtk.Orientation.VERTICAL}
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
				>
					<Gtk.GestureClick onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)} />
					<box class="wallpaper-header">
						<entry
							class="wallpaper-search"
							placeholderText="Filter wallpapers…"
							hexpand
							$={(self: Gtk.Entry) => (entry = self)}
							onNotifyText={(self: Gtk.Entry) => {
								setQuery(self.get_text())
								flow.invalidate_filter()
							}}
						/>
						<button class="wallpaper-random" tooltipText="Random wallpaper" onClicked={() => random()}>
							<label label="󰒝" />
						</button>
					</box>
					<scrolledwindow class="wallpaper-scroll" hexpand vexpand>
						<Gtk.FlowBox
							class="wallpaper-grid"
							homogeneous
							maxChildrenPerLine={4}
							minChildrenPerLine={4}
							selectionMode={Gtk.SelectionMode.NONE}
							rowSpacing={12}
							columnSpacing={12}
							$={(self: Gtk.FlowBox) => {
								flow = self
								self.set_filter_func(filter)
							}}
						>
							{walls.map((w) => (
								<button
									class="wallpaper-cell"
									overflow={Gtk.Overflow.HIDDEN}
									tooltipText={w.name}
									onClicked={() => select(w.path)}
									$={(self: Gtk.Widget) => meta.set(self, w)}
								>
									<Gtk.Picture
										contentFit={Gtk.ContentFit.COVER}
										widthRequest={200}
										heightRequest={200}
										file={Gio.File.new_for_path(w.path)}
									/>
								</button>
							))}
						</Gtk.FlowBox>
					</scrolledwindow>
				</box>
			</box>
		</window>
	)
}
