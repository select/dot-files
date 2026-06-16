import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createBinding, createComputed, For } from "ags"
import AstalWp from "gi://AstalWp"
import Pango from "gi://Pango"
import GLib from "gi://GLib"

const [revealed, setRevealed] = createState(false)

function close() {
	app.toggle_window("sound")
}

export default function Sound(gdkmonitor: Gdk.Monitor) {
	const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

	// Calculate geometry to align above the right side of the centered bar
	const geo = gdkmonitor.get_geometry()
	const barWidth = Math.round((geo.width || 1920) * 0.36)
	const marginEnd = Math.max(0, Math.round((geo.width - barWidth) / 2))

	const wp = AstalWp.get_default()!
	const speakers = createBinding(wp.audio, "speakers")
	const microphones = createBinding(wp.audio, "microphones")

	// Create states for the default speaker and microphone properties
	const [speakerMute, setSpeakerMute] = createState(wp.defaultSpeaker?.mute ?? false)
	const [speakerVolume, setSpeakerVolume] = createState(wp.defaultSpeaker?.volume ?? 0)

	const [micMute, setMicMute] = createState(wp.defaultMicrophone?.mute ?? false)
	const [micVolume, setMicVolume] = createState(wp.defaultMicrophone?.volume ?? 0)

	// Keep track of signal connections to prevent leaks and double-connections
	let currentSpeaker: AstalWp.Endpoint | null = null
	let sConnMute = 0
	let sConnVol = 0

	let currentMicrophone: AstalWp.Endpoint | null = null
	let mConnMute = 0
	let mConnVol = 0

	const syncSpeaker = (speaker: AstalWp.Endpoint | null) => {
		if (sConnMute && currentSpeaker) currentSpeaker.disconnect(sConnMute)
		if (sConnVol && currentSpeaker) currentSpeaker.disconnect(sConnVol)

		currentSpeaker = speaker

		if (!speaker) {
			setSpeakerMute(true)
			setSpeakerVolume(0)
			return
		}

		setSpeakerMute(speaker.mute)
		setSpeakerVolume(speaker.volume)

		sConnMute = speaker.connect("notify::mute", () => setSpeakerMute(speaker.mute))
		sConnVol = speaker.connect("notify::volume", () => setSpeakerVolume(speaker.volume))
	}

	const syncMicrophone = (mic: AstalWp.Endpoint | null) => {
		if (mConnMute && currentMicrophone) currentMicrophone.disconnect(mConnMute)
		if (mConnVol && currentMicrophone) currentMicrophone.disconnect(mConnVol)

		currentMicrophone = mic

		if (!mic) {
			setMicMute(true)
			setMicVolume(0)
			return
		}

		setMicMute(mic.mute)
		setMicVolume(mic.volume)

		mConnMute = mic.connect("notify::mute", () => setMicMute(mic.mute))
		mConnVol = mic.connect("notify::volume", () => setMicVolume(mic.volume))
	}

	// Initialize sync
	syncSpeaker(wp.defaultSpeaker)
	syncMicrophone(wp.defaultMicrophone)

	// Re-sync when default device changes
	wp.connect("notify::default-speaker", () => syncSpeaker(wp.defaultSpeaker))
	wp.connect("notify::default-microphone", () => syncMicrophone(wp.defaultMicrophone))

	// Helpers for slider percentages
	const speakerPercent = speakerVolume((v) => `${Math.round(v * 100)}%`)
	const micPercent = micVolume((v) => `${Math.round(v * 100)}%`)

	// Volume glyph computations
	const speakerGlyph = createComputed(() => {
		if (speakerMute() || speakerVolume() <= 0) return "󰖁"
		if (speakerVolume() < 0.34) return "󰕿"
		if (speakerVolume() < 0.67) return "󰖀"
		return "󰕾"
	})

	const micGlyph = micMute((m) => (m ? "󰍭" : "󰍬"))

	return (
		<window
			name="sound"
			namespace="sound"
			class="Sound"
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
					<box class="sound-box" orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.GestureClick
							onReleased={(g) => g.set_state(Gtk.EventSequenceState.CLAIMED)}
						/>

						{/* Speakers / Output Section */}
						<box class="sound-section" orientation={Gtk.Orientation.VERTICAL}>
							<label class="sound-title" halign={Gtk.Align.START} label="Speakers" />
							
							{/* Volume slider & Mute button row */}
							<box class="sound-slider-row" valign={Gtk.Align.CENTER}>
								<button
									class={speakerMute((m) => m ? "sound-mute-btn muted" : "sound-mute-btn")}
									tooltipText="Toggle mute"
									onClicked={() => {
										if (wp.defaultSpeaker) {
											wp.defaultSpeaker.mute = !wp.defaultSpeaker.mute
										}
									}}
								>
									<label label={speakerGlyph} />
								</button>
								<Gtk.Scale
									class="sound-scale"
									hexpand
									drawValue={false}
									$={(self) => {
										self.set_range(0, 1)
										self.set_increments(0.01, 0.1)
										
										// Initialize value
										self.set_value(wp.defaultSpeaker?.volume ?? 0)

										let lastUserChange = 0

										// Sync volume changes from speaker to slider
										const updateSlider = () => {
											if (wp.defaultSpeaker) {
												const vol = wp.defaultSpeaker.volume
												const now = GLib.get_monotonic_time()
												// Only update if the user hasn't interacted in the last 1.2 seconds
												if (now - lastUserChange > 1200000) {
													self.set_value(vol)
												}
											}
										}

										// Connect to speaker notify
										let notifyConn = 0
										const setupConn = () => {
											if (notifyConn && wp.defaultSpeaker) {
												wp.defaultSpeaker.disconnect(notifyConn)
												notifyConn = 0
											}
											if (wp.defaultSpeaker) {
												notifyConn = wp.defaultSpeaker.connect("notify::volume", () => {
													console.log("[Speaker Slider] notify::volume triggered, vol=" + wp.defaultSpeaker.volume);
													updateSlider();
												})
												const now = GLib.get_monotonic_time()
												if (now - lastUserChange > 1200000) {
													self.set_value(wp.defaultSpeaker.volume)
												}
											}
										}

										setupConn()
										const mainConn = wp.connect("notify::default-speaker", () => {
											console.log("[Speaker Slider] default speaker changed!");
											setupConn();
										})

										// Handle value changed from user dragging
										self.connect("value-changed", () => {
											const val = self.get_value()
											console.log("[Speaker Slider] UI value-changed signal, val=" + val);
											if (wp.defaultSpeaker) {
												const vol = wp.defaultSpeaker.volume
												// Update lastUserChange on EVERY change to prevent feedback overriding active dragging
												lastUserChange = GLib.get_monotonic_time()
												
												if (vol !== val) {
													console.log("[Speaker Slider] Setting speaker volume to " + val);
													wp.defaultSpeaker.volume = val
												}
											}
										})

										// Cleanup on destroy
										self.connect("destroy", () => {
											if (notifyConn && wp.defaultSpeaker) {
												wp.defaultSpeaker.disconnect(notifyConn)
											}
											wp.disconnect(mainConn)
										})
									}}
								/>
								<label class="sound-percentage" label={speakerPercent} />
							</box>

							{/* Output Device Selection List */}
							<box class="sound-device-list" orientation={Gtk.Orientation.VERTICAL}>
								<For each={speakers}>
									{(s) => (
										<button
											class={createBinding(s, "is_default")((isDef) => isDef ? "sound-device-btn active" : "sound-device-btn")}
											onClicked={() => {
												s.is_default = true
											}}
										>
											<box valign={Gtk.Align.CENTER}>
												<label
													class="sound-device-icon"
													label={createBinding(s, "is_default")((isDef) => isDef ? "󰄲 " : "󰄱 ")}
												/>
												<label
													class="sound-device-name"
													ellipsize={Pango.EllipsizeMode.END}
													maxWidthChars={26}
													label={s.description}
												/>
											</box>
										</button>
									)}
								</For>
							</box>
						</box>

						{/* Separator line */}
						<box class="sound-separator" />

						{/* Microphone / Input Section */}
						<box class="sound-section last" orientation={Gtk.Orientation.VERTICAL}>
							<label class="sound-title" halign={Gtk.Align.START} label="Microphone" />
							
							{/* Volume slider & Mute button row */}
							<box class="sound-slider-row" valign={Gtk.Align.CENTER}>
								<button
									class={micMute((m) => m ? "sound-mute-btn muted" : "sound-mute-btn")}
									tooltipText="Toggle mute"
									onClicked={() => {
										if (wp.defaultMicrophone) {
											wp.defaultMicrophone.mute = !wp.defaultMicrophone.mute
										}
									}}
								>
									<label label={micGlyph} />
								</button>
								<Gtk.Scale
									class="sound-scale"
									hexpand
									drawValue={false}
									$={(self) => {
										self.set_range(0, 1)
										self.set_increments(0.01, 0.1)
										
										// Initialize value
										self.set_value(wp.defaultMicrophone?.volume ?? 0)

										let lastUserChange = 0

										// Sync volume changes from microphone to slider
										const updateSlider = () => {
											if (wp.defaultMicrophone) {
												const vol = wp.defaultMicrophone.volume
												const now = GLib.get_monotonic_time()
												// Only update if the user hasn't interacted in the last 1.2 seconds
												if (now - lastUserChange > 1200000) {
													self.set_value(vol)
												}
											}
										}

										// Connect to microphone notify
										let notifyConn = 0
										const setupConn = () => {
											if (notifyConn && wp.defaultMicrophone) {
												wp.defaultMicrophone.disconnect(notifyConn)
												notifyConn = 0
											}
											if (wp.defaultMicrophone) {
												notifyConn = wp.defaultMicrophone.connect("notify::volume", () => {
													console.log("[Mic Slider] notify::volume triggered, vol=" + wp.defaultMicrophone.volume);
													updateSlider();
												})
												const now = GLib.get_monotonic_time()
												if (now - lastUserChange > 1200000) {
													self.set_value(wp.defaultMicrophone.volume)
												}
											}
										}

										setupConn()
										const mainConn = wp.connect("notify::default-microphone", () => {
											console.log("[Mic Slider] default microphone changed!");
											setupConn();
										})

										// Handle value changed from user dragging
										self.connect("value-changed", () => {
											const val = self.get_value()
											console.log("[Mic Slider] UI value-changed signal, val=" + val);
											if (wp.defaultMicrophone) {
												const vol = wp.defaultMicrophone.volume
												// Update lastUserChange on EVERY change to prevent feedback overriding active dragging
												lastUserChange = GLib.get_monotonic_time()
												
												if (vol !== val) {
													console.log("[Mic Slider] Setting mic volume to " + val);
													wp.defaultMicrophone.volume = val
												}
											}
										})

										// Cleanup on destroy
										self.connect("destroy", () => {
											if (notifyConn && wp.defaultMicrophone) {
												wp.defaultMicrophone.disconnect(notifyConn)
											}
											wp.disconnect(mainConn)
										})
									}}
								/>
								<label class="sound-percentage" label={micPercent} />
							</box>

							{/* Input Device Selection List */}
							<box class="sound-device-list" orientation={Gtk.Orientation.VERTICAL}>
								<For each={microphones}>
									{(m) => (
										<button
											class={createBinding(m, "is_default")((isDef) => isDef ? "sound-device-btn active" : "sound-device-btn")}
											onClicked={() => {
												m.is_default = true
											}}
										>
											<box valign={Gtk.Align.CENTER}>
												<label
													class="sound-device-icon"
													label={createBinding(m, "is_default")((isDef) => isDef ? "󰄲 " : "󰄱 ")}
												/>
												<label
													class="sound-device-name"
													ellipsize={Pango.EllipsizeMode.END}
													maxWidthChars={26}
													label={m.description}
												/>
											</box>
										</button>
									)}
								</For>
							</box>
						</box>

					</box>
				</revealer>
			</box>
		</window>
	)
}
