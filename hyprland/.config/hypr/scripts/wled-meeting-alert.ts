#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, watch } from "fs";
import { join } from "path";
import { homedir } from "os";
import dgram from "dgram";

const EVENTS_FILE = join(homedir(), ".local", "share", "deckblaster", "calendar-day-events.json");
const STATE_FILE = "/tmp/wled-meeting-alerts.json";
const AMBILIGHT_TOGGLE_SCRIPT = join(homedir(), "Dev", "deckblaster", "deckmaster", "decks", "ambilight", "ambilight-toggle.ts");

interface Event {
  dt: string;
  end_dt: string;
  summary: string;
  location: string;
}

interface AlertState {
  meetingId: string;
  fired: number[];
}

let activeTimers: Timer[] = [];

// 1. Helper to format logs with timestamps
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 2. Load WLED Configuration from environment files
function loadConfig() {
  const env: Record<string, string> = {};
  const paths = [
    join(homedir(), ".config", "deckblaster.env")
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const index = trimmed.indexOf("=");
          if (index !== -1) {
            const key = trimmed.slice(0, index).trim();
            let val = trimmed.slice(index + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            env[key] = val;
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return {
    wledIp: env.WLED_SCHREIBTISCH_IP || "192.168.1.188",
    ledCount: parseInt(env.AMBILIGHT_LED_COUNT, 10) || 80
  };
}

// 3. Send raw solid RGB color over WLED UDP DRGB protocol
function sendWledColor(r: number, g: number, b: number, ip: string, ledCount: number) {
  const socket = dgram.createSocket("udp4");
  const packet = Buffer.alloc(2 + ledCount * 3);
  packet[0] = 2; // DRGB Protocol Identifier
  packet[1] = 2; // Timeout (2 seconds for quick reversion)
  for (let i = 0; i < ledCount; i++) {
    const idx = 2 + i * 3;
    packet[idx] = r;
    packet[idx + 1] = g;
    packet[idx + 2] = b;
  }

  socket.send(packet, 21324, ip, (err) => {
    if (err) {
      console.error(`WLED UDP send error:`, err);
    }
    socket.close();
  });
}

// 4. Stop Ambilight, perform blink sequence, and restart if it was running
async function blink(n: number, ip: string, ledCount: number) {
  log(`Blinking red ${n} time(s) for WLED at ${ip}...`);

  let wasAmbilightRunning = false;
  if (existsSync(AMBILIGHT_TOGGLE_SCRIPT)) {
    try {
      const proc = Bun.spawn([AMBILIGHT_TOGGLE_SCRIPT, "status"]);
      const statusText = (await new Response(proc.stdout).text()).trim();
      if (statusText === "running") {
        wasAmbilightRunning = true;
        log("Ambilight is currently running. Temporarily stopping it...");
        await Bun.spawn([AMBILIGHT_TOGGLE_SCRIPT, "stop"]).exited;
      }
    } catch (e) {
      log(`Error checking/stopping Ambilight: ${e}`);
    }
  }

  // Blink sequence: red for 1s, black for 1s
  for (let i = 0; i < n; i++) {
    log(`Blink ${i + 1}/${n} - RED`);
    // Send UDP packets repeatedly for 1 second to ensure WLED receives them
    for (let j = 0; j < 5; j++) {
      sendWledColor(255, 0, 0, ip, ledCount);
      await Bun.sleep(200);
    }

    log(`Blink ${i + 1}/${n} - OFF`);
    // Send black color repeatedly for 1 second to turn off cleanly
    for (let j = 0; j < 5; j++) {
      sendWledColor(0, 0, 0, ip, ledCount);
      await Bun.sleep(200);
    }
  }

  if (wasAmbilightRunning) {
    log("Restarting Ambilight...");
    try {
      await Bun.spawn([AMBILIGHT_TOGGLE_SCRIPT, "start"]).exited;
    } catch (e) {
      log(`Error restarting Ambilight: ${e}`);
    }
  }
}

// 5. Manage Alert State (persist to temp file to avoid repeating on daemon restart)
function loadAlertState(): AlertState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch {
      // ignore
    }
  }
  return { meetingId: "", fired: [] };
}

function saveAlertState(state: AlertState) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save alert state:", e);
  }
}

// 6. Clear all pending timeouts
function clearAllTimers() {
  if (activeTimers.length > 0) {
    log(`Clearing ${activeTimers.length} pending alert timer(s)...`);
    for (const t of activeTimers) {
      clearTimeout(t);
    }
    activeTimers = [];
  }
}

// 7. Parse the calendar file and schedule upcoming alert timers
function scheduleAlerts() {
  clearAllTimers();

  if (!existsSync(EVENTS_FILE)) {
    log(`Calendar file not found at ${EVENTS_FILE}`);
    return;
  }

  try {
    const data = JSON.parse(readFileSync(EVENTS_FILE, "utf8"));
    const now = Date.now();
    const state = loadAlertState();

    // Check events from today ("0") and tomorrow ("1")
    const upcoming: Event[] = [];
    for (const offset of ["0", "1"]) {
      const dayEvents = data.days?.[offset] || [];
      for (const e of dayEvents) {
        upcoming.push(e);
      }
    }

    const { wledIp, ledCount } = loadConfig();

    for (const evt of upcoming) {
      const start = new Date(evt.dt).getTime();
      const meetingId = `${evt.dt}_${evt.summary}`;

      // Alert thresholds in seconds before meeting start
      const thresholds = [
        { t: 180, blinks: 1, label: "3 min before" },
        { t: 120, blinks: 2, label: "2 min before" },
        { t: 60, blinks: 3, label: "1 min before" }
      ];

      for (const { t, blinks, label } of thresholds) {
        const alertTime = start - t * 1000;
        const delay = alertTime - now;

        // If this alert time is in the future
        if (delay > 0) {
          // Check if this specific threshold was already fired
          const isFired = state.meetingId === meetingId && state.fired.includes(t);
          if (!isFired) {
            const timeDesc = new Date(alertTime).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            log(`Scheduling "${label}" for "${evt.summary}" at ${timeDesc} (in ${Math.round(delay / 1000)}s)`);
            
            const timer = setTimeout(async () => {
              log(`Triggering scheduled alert: ${label} for meeting "${evt.summary}"`);
              
              // Record alert as fired
              const currentState = loadAlertState();
              if (currentState.meetingId !== meetingId) {
                currentState.meetingId = meetingId;
                currentState.fired = [];
              }
              if (!currentState.fired.includes(t)) {
                currentState.fired.push(t);
              }
              saveAlertState(currentState);

              // Perform blink
              await blink(blinks, wledIp, ledCount);
            }, delay);

            activeTimers.push(timer);
          }
        }
      }
    }

    log(`Total alerts scheduled: ${activeTimers.length}`);
  } catch (e) {
    console.error("Error scheduling alerts:", e);
  }
}

// 8. Watch the calendar directory for any updates
function startWatcher() {
  const dir = join(homedir(), ".local", "share", "deckblaster");
  if (!existsSync(dir)) {
    log(`Directory ${dir} does not exist yet. Retrying watch in 10s...`);
    setTimeout(startWatcher, 10000);
    return;
  }

  log(`Watching directory ${dir} for updates...`);
  watch(dir, (eventType, filename) => {
    if (filename === "calendar-day-events.json") {
      log(`Detected update to calendar-day-events.json. Re-scheduling alerts...`);
      scheduleAlerts();
    }
  });
}

// 9. Main Entry
async function main() {
  const [,, cmd, arg] = process.argv;
  if (cmd === "test") {
    const blinks = parseInt(arg, 10) || 1;
    const { wledIp, ledCount } = loadConfig();
    log(`[TEST] Triggering immediate ${blinks} blink(s) on WLED at ${wledIp} with ${ledCount} LEDs...`);
    await blink(blinks, wledIp, ledCount);
    process.exit(0);
  }

  log("WLED Calendar Meeting Alert service started (Event-Driven Mode).");
  
  // Clean up any stale alerts on startup if meeting is in the past
  const state = loadAlertState();
  if (state.meetingId) {
    const startIso = state.meetingId.split("_")[0];
    if (startIso && new Date(startIso).getTime() < Date.now()) {
      log("Clearing stale alert state from previous meeting.");
      saveAlertState({ meetingId: "", fired: [] });
    }
  }

  // Initial schedule
  scheduleAlerts();

  // Start watching directory for changes
  startWatcher();
}

// Handle clean shutdown signals
process.on("SIGINT", () => {
  log("Shutting down cleanly.");
  clearAllTimers();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Terminated.");
  clearAllTimers();
  process.exit(0);
});

main();
