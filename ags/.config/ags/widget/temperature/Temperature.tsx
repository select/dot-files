import app from "ags/gtk4/app";
import { Astal, Gtk, Gdk } from "ags/gtk4";
import { createState } from "ags";
import { execAsync } from "ags/process";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { palette } from "../../lib/wal";

interface DataPoint {
	time: Date;
	value: number;
}

// ── ENVIRONMENT / CONFIG LOAD ──────────────────────────────────────────────
// Load variables from private env config file outside the repo to avoid committing any PII.
function loadPrivateConfig() {
	const home = GLib.get_home_dir();
	const configPath = `${home}/.config/deckblaster.env`;
	const conf: Record<string, string> = {};

	try {
		const [, content] = GLib.file_get_contents(configPath);
		const lines = content.toString().split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const clean = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
			const eqIndex = clean.indexOf("=");
			if (eqIndex === -1) continue;

			const key = clean.slice(0, eqIndex).trim();
			let val = clean.slice(eqIndex + 1).trim();

			if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
			if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);

			conf[key] = val;
		}
	} catch {
		// Silent fallback if file doesn't exist
	}

	return {
		HA_URL: GLib.getenv("HA_URL") || conf["HA_URL"] || "",
		HA_TOKEN: GLib.getenv("HA_TOKEN") || conf["HA_TOKEN"] || "",
		HA_INSIDE_SENSOR: GLib.getenv("HA_INSIDE_SENSOR") || conf["HA_INSIDE_SENSOR"] || "sensor.bad_oben_temperature",
		HA_OUTSIDE_SENSOR: GLib.getenv("HA_OUTSIDE_SENSOR") || conf["HA_OUTSIDE_SENSOR"] || "sensor.bewegung_tur_almut_temperature",
		HA_TITLE: GLib.getenv("HA_TITLE") || conf["HA_TITLE"] || "Home Temperature",
	};
}

const config = loadPrivateConfig();

// Path to the private env file (kept outside the repo so no PII is committed).
const CONFIG_FILE = `${GLib.get_home_dir()}/.config/deckblaster.env`;

interface MissingItem {
	key: string;
	hint: string;
}

// Required for the widget to fetch anything. Sensor IDs / title fall back to
// defaults, so only the URL + token are treated as hard requirements.
function missingConfig(): MissingItem[] {
	const items: MissingItem[] = [];
	if (!config.HA_URL) {
		items.push({
			key: "HA_URL",
			hint: "Home Assistant base URL, e.g. http://homeassistant.local:8123",
		});
	}
	if (!config.HA_TOKEN) {
		items.push({
			key: "HA_TOKEN",
			hint: "Long-lived access token (HA → Settings → People → you → Long-Lived Access Tokens)",
		});
	}
	return items;
}

const missing = missingConfig();

// ── CACHING FUNCTIONS ────────────────────────────────────────────────────────
const CACHE_PATH = `${GLib.get_user_cache_dir()}/ags-temp-cache.json`;

interface CachePayload {
	inside: Array<{ time: string; value: number }>;
	outside: Array<{ time: string; value: number }>;
}

function readLocalCache(): { inside: DataPoint[]; outside: DataPoint[] } | null {
	try {
		const file = Gio.File.new_for_path(CACHE_PATH);
		const [, content] = file.load_contents(null);
		const parsed = JSON.parse(new TextDecoder("utf-8").decode(content)) as CachePayload;

		const inside = parsed.inside.map((p) => ({ time: new Date(p.time), value: p.value }));
		const outside = parsed.outside.map((p) => ({ time: new Date(p.time), value: p.value }));

		return { inside, outside };
	} catch {
		return null;
	}
}

function writeLocalCache(inside: DataPoint[], outside: DataPoint[]) {
	try {
		const file = Gio.File.new_for_path(CACHE_PATH);
		const payload: CachePayload = {
			inside: inside.map((p) => ({ time: p.time.toISOString(), value: p.value })),
			outside: outside.map((p) => ({ time: p.time.toISOString(), value: p.value })),
		};
		file.replace_contents(
			new TextEncoder().encode(JSON.stringify(payload)),
			null,
			false,
			Gio.FileCreateFlags.REPLACE_DESTINATION,
			null,
		);
	} catch (e) {
		console.error("Error writing temperature cache:", e);
	}
}

// ── STATE PARSING ────────────────────────────────────────────────────────────
function parseHistory(jsonText: string) {
	try {
		const data = JSON.parse(jsonText);
		if (!Array.isArray(data)) return null;

		const inside: DataPoint[] = [];
		const outside: DataPoint[] = [];

		for (const entityArray of data) {
			if (!Array.isArray(entityArray) || entityArray.length === 0) continue;
			const first = entityArray[0];
			const entityId = first.entity_id;
			const list = entityId === config.HA_INSIDE_SENSOR ? inside : outside;
			const isWeather = entityId.startsWith("weather.");

			for (const point of entityArray) {
				const val = isWeather
					? parseFloat(point.attributes?.temperature)
					: parseFloat(point.state);
				if (isNaN(val)) continue;
				list.push({
					time: new Date(point.last_updated),
					value: val,
				});
			}
		}

		inside.sort((a, b) => a.time.getTime() - b.time.getTime());
		outside.sort((a, b) => a.time.getTime() - b.time.getTime());

		return { inside, outside };
	} catch (e) {
		console.error("Error parsing history:", e);
		return null;
	}
}

function getRgb(hexColor: string) {
	const h = hexColor.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	return { r, g, b };
}

// ── WIDGET COMPONENT ─────────────────────────────────────────────────────────
export default function Temperature(gdkmonitor: Gdk.Monitor) {
	const { RIGHT, TOP } = Astal.WindowAnchor;

	const [insideTemp, setInsideTemp] = createState("...");
	const [outsideTemp, setOutsideTemp] = createState("...");
	const [insideHistory, setInsideHistory] = createState<DataPoint[]>([]);
	const [outsideHistory, setOutsideHistory] = createState<DataPoint[]>([]);

	let drawingArea: Gtk.DrawingArea;

	// 1. Try to load instantly from cache on startup
	const cached = readLocalCache();
	if (cached) {
		setInsideHistory(cached.inside);
		setOutsideHistory(cached.outside);
		if (cached.inside.length > 0) {
			setInsideTemp(cached.inside[cached.inside.length - 1].value.toFixed(1));
		}
		if (cached.outside.length > 0) {
			setOutsideTemp(cached.outside[cached.outside.length - 1].value.toFixed(1));
		}
	}

	// 2. Async fetch in background
	async function updateData() {
		if (!config.HA_TOKEN || !config.HA_URL) return;

		const hours24Ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		try {
			const stdout = await execAsync([
				"curl",
				"-s",
				"-H",
				`Authorization: Bearer ${config.HA_TOKEN}`,
				`${config.HA_URL}/api/history/period/${hours24Ago}?filter_entity_id=${config.HA_INSIDE_SENSOR},${config.HA_OUTSIDE_SENSOR}`,
			]);

			const parsed = parseHistory(stdout);
			if (parsed) {
				setInsideHistory(parsed.inside);
				setOutsideHistory(parsed.outside);

				if (parsed.inside.length > 0) {
					setInsideTemp(parsed.inside[parsed.inside.length - 1].value.toFixed(1));
				}
				if (parsed.outside.length > 0) {
					setOutsideTemp(parsed.outside[parsed.outside.length - 1].value.toFixed(1));
				}

				// Redraw vector area
				drawingArea?.queue_draw();

				// Save successful fetch to local cache for instant load next time
				writeLocalCache(parsed.inside, parsed.outside);
			}
		} catch (err) {
			console.error("Error fetching HA temperatures:", err);
		}
	}

	// Fetch current data in the background
	updateData();

	// Poll for updates in the background
	const intervalId = setInterval(updateData, 5 * 60 * 1000);

	const drawGraph = (
		area: Gtk.DrawingArea,
		cr: any,
		width: number,
		height: number,
	) => {
		const inside = insideHistory.get();
		const outside = outsideHistory.get();

		// Clean transparent canvas
		cr.setSourceRGBA(0, 0, 0, 0);
		cr.paint();

		const now = Date.now();
		const xMin = now - 24 * 60 * 60 * 1000;
		const xMax = now;

		let yMin = 15;
		let yMax = 35;

		const allVals = [
			...inside.map((p) => p.value),
			...outside.map((p) => p.value),
		];

		if (allVals.length > 0) {
			yMin = Math.min(...allVals) - 1.5;
			yMax = Math.max(...allVals) + 1.5;
		}

		if (yMax - yMin < 2) {
			yMax = yMin + 2;
		}

		const mapX = (time: Date) => {
			const t = time.getTime();
			const pct = (t - xMin) / (xMax - xMin);
			return pct * width;
		};

		const mapY = (val: number) => {
			const pct = (val - yMin) / (yMax - yMin);
			return (1 - pct) * height;
		};

		// 1. Draw horizontal grid lines (much more subtle)
		cr.setLineWidth(1);
		cr.setSourceRGBA(1, 1, 1, 0.04);

		const gridLines = 2;
		for (let i = 0; i <= gridLines; i++) {
			const val = yMin + (i / gridLines) * (yMax - yMin);
			const y = mapY(val);
			cr.moveTo(0, y);
			cr.lineTo(width, y);
			cr.stroke();

			// Text value labels (much more subtle)
			cr.setSourceRGBA(1, 1, 1, 0.16);
			cr.setFontSize(8.5);
			cr.moveTo(4, y - 4);
			cr.showText(`${val.toFixed(1)}°C`);
		}

		// 2. Plot curves
		const drawCurve = (points: DataPoint[], hexColor: string) => {
			if (points.length === 0) return;
			const rgb = getRgb(hexColor);
			cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 0.95);
			cr.setLineWidth(2.2);

			let first = true;
			for (const p of points) {
				const x = mapX(p.time);
				const y = mapY(p.value);
				if (first) {
					cr.moveTo(x, y);
					first = false;
				} else {
					cr.lineTo(x, y);
				}
			}
			cr.stroke();
		};

		// Inside curve: Pywal color[3]
		drawCurve(inside, palette.get().color[3]);
		// Outside curve: Pywal color[5]
		drawCurve(outside, palette.get().color[5]);
	};

	return (
		<window
			visible={false}
			name="temperature"
			namespace="ags-temperature"
			class="Temperature"
			gdkmonitor={gdkmonitor}
			anchor={RIGHT | TOP}
			exclusivity={Astal.Exclusivity.NORMAL}
			layer={Astal.Layer.BACKGROUND}
			marginTop={24}
			marginRight={24}
			application={app}
			$={(self) => {
				self.layer = Astal.Layer.BACKGROUND;
				self.set_visible(true);
				self.connect("destroy", () => clearInterval(intervalId));
			}}
		>
			<box class="temp-container" orientation={Gtk.Orientation.VERTICAL} widthRequest={320}>
				<centerbox>
					<box $type="start">
						<label class="temp-title" label={config.HA_TITLE} />
					</box>
					<box $type="center" />
					<box class="temp-end-badges" $type="end" spacing={8} visible={!missing.length}>
						<label
							class="temp-inside-badge"
							label={insideTemp((t) => `󰋜  ${t}°C`)}
						/>
						<label
							class="temp-outside-badge"
							label={outsideTemp((t) => `󰖏  ${t}°C`)}
						/>
					</box>
				</centerbox>

				{missing.length > 0 ? (
					<box class="temp-error" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
						<label
							class="temp-error-title"
							halign={Gtk.Align.START}
							label="Temperature widget not configured"
						/>
						<label
							class="temp-error-hint"
							halign={Gtk.Align.START}
							wrap
							label={`Add the following keys to ${CONFIG_FILE} (or export them as environment variables), then restart AGS:`}
						/>
						{missing.map((m) => (
							<box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
								<label
									class="temp-error-key"
									halign={Gtk.Align.START}
									label={m.key}
								/>
								<label
									class="temp-error-desc"
									halign={Gtk.Align.START}
									wrap
									label={`↳ ${m.hint}`}
								/>
							</box>
						))}
					</box>
				) : (
					<box orientation={Gtk.Orientation.VERTICAL}>
						<Gtk.DrawingArea
							class="temp-drawing-area"
							heightRequest={160}
							$={(self) => {
								drawingArea = self;
								self.set_draw_func(drawGraph);
							}}
						/>

						<centerbox>
							<box $type="start">
								<label class="temp-footer-label" label="24h ago" />
							</box>
							<box $type="center" />
							<box $type="end">
								<label class="temp-footer-label" label="Now" />
							</box>
						</centerbox>
					</box>
				)}
			</box>
		</window>
	);
}
