import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createBinding, createComputed } from "ags"
import { execAsync } from "ags/process"
import { createPoll } from "ags/time"
import Pango from "gi://Pango"
import GLib from "gi://GLib"

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("hyprland-settings")
}

export default function HyprlandSettings(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// Calculate geometry to align above the right side of the centered bar
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginEnd = Math.max(0, Math.round((geo.width - barWidth) / 2))

	// Polling states for real-time reactivity
	const animationsEnabled = createPoll(true, 1500, () =>
		execAsync(["bash", "-c", "hyprctl -j getoption animations:enabled | jq --raw-output '.bool'"])
			.then((o) => o.trim() === "true")
			.catch(() => true)
	)

	const cursorEffect = createPoll("stretch", 1500, () =>
		execAsync(["bash", "-c", "cat $HOME/.config/hypr/state/cursor-mode 2>/dev/null || echo stretch"])
			.then((o) => o.trim())
			.catch(() => "stretch")
	)

	const displayMode = createPoll("both", 1500, () =>
		execAsync(["bash", "-c", "cat $HOME/.config/hypr/state/display-mode 2>/dev/null || echo both"])
			.then((o) => o.trim())
			.catch(() => "both")
	)

	const toggleAnimations = () => {
		execAsync(["bash", `${GLib.get_home_dir()}/.config/hypr/scripts/toggle_animations.sh`])
			.catch((err) => console.error("Error toggling animations:", err))
	}

	const cycleCursorEffect = () => {
		execAsync(["bash", `${GLib.get_home_dir()}/.config/hypr/scripts/cursor-effect.sh`, "next"])
			.catch((err) => console.error("Error cycling cursor effect:", err))
	}

	const cycleDisplayMode = () => {
		execAsync(["bash", `${GLib.get_home_dir()}/.config/hypr/scripts/display-cycle.sh`, "cycle"])
			.catch((err) => console.error("Error cycling display mode:", err))
	}

	const displayModeLabel = createComputed(() => {
		const m = displayMode()
		if (m === "laptop") return "Laptop"
		if (m === "external") return "External"
		return "Both"
	})

	const cursorEffectLabel = createComputed(() => {
		const m = cursorEffect()
		return m.charAt(0).toUpperCase() + m.slice(1)
	})

	return (
		<window
			name="hyprland-settings"
			namespace="hyprland-settings"
			class="HyprlandSettings"
			gdkmonitor={gdkmonitor}
			anchor={TOP | BOTTOM | LEFT | RIGHT}
			exclusivity={Astal.Exclusivity.IGNORE}
			keymode={Astal.Keymode.ON_DEMAND}
			layer={Astal.Layer.OVERLAY}
			marginBottom={50}
			application={app}
			visible={false}
			$={(self) => self.connect("notify::visible", () => setRevealed(self.visible))}
		>
			<Gtk.EventControllerKey
				onKeyPressed={({}, keyval: number) => {
					if (keyval === Gdk.KEY_Escape) close()
				}}
			/>
			<box>
				<Gtk.GestureClick onReleased={() => close()} />
				<revealer
					halign={Gtk.Align.END}
					valign={Gtk.Align.END}
					marginEnd={marginEnd}
					marginBottom={0}
					revealChild={revealed}
					transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
					transitionDuration={200}
				>
					<box class="hypr-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Header Section */}
						<box class="hypr-header" valign={Gtk.Align.CENTER}>
							<label class="hypr-title" halign={Gtk.Align.START} label="Hyprland Settings" />
						</box>

						{/* Quick Toggles Section */}
						<box class="hypr-section" orientation={Gtk.Orientation.VERTICAL}>
							<label class="hypr-list-subtitle" halign={Gtk.Align.START} label="System Toggles" />
							
							{/* Animations Toggle */}
							<button class="hypr-row-btn" onClicked={toggleAnimations}>
								<box valign={Gtk.Align.CENTER} hexpand>
									<label class="hypr-row-icon" label="󰵈" />
									<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
										<label class="hypr-row-title" halign={Gtk.Align.START} label="Animations" />
										<label class="hypr-row-desc" halign={Gtk.Align.START} label={animationsEnabled((enabled) => enabled ? "Animations & padding enabled" : "Performance mode (flat/gaps-off)")} />
									</box>
									<switch
										class="hypr-switch"
										valign={Gtk.Align.CENTER}
										active={animationsEnabled}
										onStateSet={(self, state) => {
											// avoid loop if clicked outside
											if (state !== animationsEnabled.get()) {
												toggleAnimations()
											}
											return true
										}}
									/>
								</box>
							</button>

							{/* Dynamic Cursor Effect Cycle */}
							<button class="hypr-row-btn" onClicked={cycleCursorEffect}>
								<box valign={Gtk.Align.CENTER} hexpand>
									<label class="hypr-row-icon" label="󰳽" />
									<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
										<label class="hypr-row-title" halign={Gtk.Align.START} label="Mouse Effect" />
										<label class="hypr-row-desc" halign={Gtk.Align.START} label={createComputed(() => `Active mode: ${cursorEffectLabel()}`)} />
									</box>
									<box class="hypr-badge" valign={Gtk.Align.CENTER}>
										<label label={cursorEffectLabel} />
									</box>
								</box>
							</button>

							{/* Display Mode Cycle */}
							<button class="hypr-row-btn" onClicked={cycleDisplayMode}>
								<box valign={Gtk.Align.CENTER} hexpand>
									<label class="hypr-row-icon" label="󰍹" />
									<box orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} hexpand>
										<label class="hypr-row-title" halign={Gtk.Align.START} label="Display Layout" />
										<label class="hypr-row-desc" halign={Gtk.Align.START} label={createComputed(() => `Active screens: ${displayModeLabel()}`)} />
									</box>
									<box class="hypr-badge" valign={Gtk.Align.CENTER}>
										<label label={displayModeLabel} />
									</box>
								</box>
							</button>
						</box>

						{/* Quick Tools Section */}
						<box class="hypr-section last" orientation={Gtk.Orientation.VERTICAL}>
							<label class="hypr-list-subtitle" halign={Gtk.Align.START} label="Quick Tools" />
							
							<box spacing={8} homogeneous>
								{/* Wallpaper Selector Button */}
								<button
									class="hypr-tool-btn"
									onClicked={() => {
										close()
										app.toggle_window("wallpaper")
									}}
								>
									<box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
										<label class="hypr-tool-icon" label="󰏘" />
										<label class="hypr-tool-label" label="Wallpaper" />
									</box>
								</button>

								{/* Screenshot / Screen Capture Button */}
								<button
									class="hypr-tool-btn"
									onClicked={() => {
										close()
										app.toggle_window("capture")
									}}
								>
									<box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
										<label class="hypr-tool-icon" label="󰄄" />
										<label class="hypr-tool-label" label="Capture" />
									</box>
								</button>
							</box>
						</box>
					</box>
				</revealer>
			</box>
		</window>
	)
}
