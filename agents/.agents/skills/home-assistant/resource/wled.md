# WLED HTTP API — Custom Palettes, Presets & the PIN Mechanism

Reference for driving a WLED device (the **Schreibtisch** strip at `WLED_SCHREIBTISCH_IP`,
WLED 0.15.1 / ESP8266, 80 LEDs) directly over HTTP. WLED is **not** exposed through Home
Assistant — it is controlled via its own JSON API on the device.

> **Why a palette you "set" never shows up in the UI:** the `/json/cpal` endpoint is
> **read-only** — it only *lists* custom palettes. POSTing a palette object to it does
> nothing. Custom palettes are **filesystem files** (`/palette0.json` …) that must be
> **uploaded** (after PIN unlock) and then the device **rebooted**. Only then do they appear
> in the palette picker as `~ Custom 0 ~` (index `255`).
>
> **Two more steps to actually *see* it in `#Colors`:**
> 1. **Reboot the device** (`{"rb":true}`) — palette files are read only at startup.
> 2. **Clear the browser cache** — the web UI caches `/json/palx` in `localStorage` under
>    key `wledPalx`, so a newly uploaded palette won't appear in the picker until you run
>    `localStorage.removeItem('wledPalx')` in the WLED tab's DevTools console (F12) and reload.

## Endpoints & Auth

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/json/state`, `/json/info`, `/json/palx` | GET/POST | **none** | Live state, info, palette data |
| `/upload` | POST (multipart) | **PIN unlock** | Write files to the filesystem |
| `/edit` | GET / DELETE | **PIN cookie** | List, read, delete files |
| `/settings/sec` | POST | — | Unlock (set the PIN cookie / global `correctPIN`) |

`/json/state`, `/json/info` and `/json/palx` require **no auth**. Both `/upload` and `/edit`
require a prior PIN unlock — `/upload` checks the firmware’s global `correctPIN` flag (set
by the unlock POST), `/edit` additionally checks the session cookie.

### The PIN unlock (cookie mechanism)

`/edit` does **not** use HTTP Basic Auth. It uses a session cookie that is set when you POST
the PIN to `/settings/sec`. Reuse the same cookie jar (`-c` / `-b`) for every protected call:

```bash
source ~/.config/deckblaster.env   # provides WLED_SCHREIBTISCH_IP
WLED="http://$WLED_SCHREIBTISCH_IP"
PIN="<pin>"   # device settings PIN (4 digits)

# Unlock — sets the session cookie in the jar
curl -s -c /tmp/wled.txt -b /tmp/wled.txt \
  -X POST "$WLED/settings/sec" -d "PIN=$PIN" > /dev/null

# Now any /edit request works as long as the cookie is passed
curl -s -c /tmp/wled.txt -b /tmp/wled.txt "$WLED/edit?list=/"
```

The unlock sets the firmware’s **global `correctPIN` flag** (and a session cookie).
`/upload` checks only the global flag; `/edit` checks the cookie. The flag/cookie can lapse —
re-POST the PIN before each protected batch if requests start returning
*“Please unlock settings using PIN code!”*.

## Custom Palettes

### File format

Custom palettes live on the SPIFFS filesystem as `/palette0.json` … `/palette7.json`.
Format is a flat array of alternating `position` (0–255) and `"rrggbb"` hex strings:

```json
{"palette":[0,"6b5f91",36,"cdb8ec",73,"aa91bf",109,"956eb3",146,"5c3e71",182,"231421",219,"8e5680",255,"54283d"]}
```

- Up to 16 stops (18 array elements) per palette.
- First stop must be at position `0`, last at `255` (anchor both ends).
- The gradient wraps — make first and last colors transition gracefully or the wrap point shows as a jump.
- Avoid near-black stops (brightness < ~40); they render as dead patches on the strip.

### Index scheme (the big gotcha)

Both firmware **and** web UI index custom palettes as **`255 - j`**:

| File | Selectable index | Shows in UI as |
|---|---|---|
| `/palette0.json` | `255` | `~ Custom 0 ~` |
| `/palette1.json` | `254` | `~ Custom 1 ~` |
| `/palette2.json` | `253` | `~ Custom 2 ~` |

`cpalcount` in `/json/info` reports how many custom palette **files** are loaded — on this
ESP8266 all slots load (currently `cpalcount: 3`). Do **not** use the legacy `pal: 71/72/73`
indices — they silently revert to `0` (Default) and, if stored in a preset, crash the web UI’s
palette picker (`TypeError: … querySelector … null`).

### Upload + activate (full flow)

```bash
source ~/.config/deckblaster.env
WLED="http://$WLED_SCHREIBTISCH_IP"

# 1. Write the palette JSON locally
cat > /tmp/palette0.json <<'EOF'
{"palette":[0,"6b5f91",36,"cdb8ec",73,"aa91bf",109,"956eb3",146,"5c3e71",182,"231421",219,"8e5680",255,"54283d"]}
EOF

# 2. Unlock (sets correctPIN + cookie) — REQUIRED for /upload
PIN="<pin>"
curl -s -c /tmp/wled.txt -b /tmp/wled.txt -X POST "$WLED/settings/sec" -d "PIN=$PIN" > /dev/null

# 3. Upload via /upload — multipart field name is "data" (matches cpal.htm), NOT "file"
curl -s -X POST "$WLED/upload" \
  -F "data=@/tmp/palette0.json;filename=/palette0.json"

# 4. Reboot — palette files are only read at startup
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" -d '{"rb":true}'
# wait ~7s for the device to come back, polling /json/info

# 5. Clear the browser cache — the web UI caches /json/palx in localStorage,
#    so a newly uploaded palette won't appear in the #Colors picker until you
#    invalidate it. In the WLED browser tab DevTools console (F12):
#        localStorage.removeItem('wledPalx')
#    then reload the page.

# 6. Select the palette on segment 0 (pal=255 → palette0.json)
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" \
  -d '{"seg":[{"id":0,"pal":255}]}'
```

### Verifying the live palette (no auth)

`/json/palx` is paginated and needs no PIN. Custom palettes live on the last page:

```bash
# Find the page holding ids 253/254/255, then:
curl -s "$WLED/json/palx?page=14" | python3 -c "
import json,sys
for pid,stops in json.load(sys.stdin)['p'].items():
    if int(pid) >= 253:
        print(f'pal={pid}:')
        for pos,r,g,b in stops: print(f'  {pos:3d} #{r:02x}{g:02x}{b:02x}')
"
```

### No palette naming

WLED has no mechanism to name a custom palette file. The palette always shows as
`~ Custom 0 ~` in the picker. A human-readable name lives only on a **preset** that references
the palette.

## Presets

### Read presets (PIN-protected)

```bash
curl -s -c /tmp/wled.txt -b /tmp/wled.txt "$WLED/edit?edit=/presets.json"
```

### Save the current state as a preset (no auth)

Use **two separate calls** — combining `psave` with `seg` changes in one body races and saves
an incomplete preset (`pal` reverts to `0`):

```bash
# 1. Apply the state you want
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" \
  -d '{"seg":[{"id":0,"fx":110,"pal":255,"sx":15,"ix":5}]}'

# 2. Save it (separate call)
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" \
  -d '{"psave":11,"n":"Evening Clouds"}'

# 3. Activate later
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" -d '{"ps":11}'
```

### Writing presets.json directly

A preset saved via `psave` omits the `start`/`stop` fields and the 15 `{"stop":0}` padding
entries the web UI expects for the 16 segment slots. Writing a hand-built preset to
`presets.json` (via `/upload`) that lacks this full structure makes the UI crash with the same
`querySelector null` error. Copy the full segment shape from a working preset:

```json
{
  "mainseg": 0,
  "seg": [
    {"id":0,"start":0,"stop":80,"grp":1,"spc":0,"of":0,"on":true,"frz":false,
     "bri":255,"cct":127,"set":0,"col":[[255,160,0],[0,0,0],[0,0,0]],
     "fx":110,"sx":15,"ix":5,"pal":255,"c1":128,"c2":128,"c3":16,
     "sel":true,"rev":false,"mi":false,"o1":false,"o2":false,"o3":false,"si":0,"m12":1},
    {"stop":0},{"stop":0},{"stop":0},{"stop":0},
    {"stop":0},{"stop":0},{"stop":0},{"stop":0},
    {"stop":0},{"stop":0},{"stop":0},{"stop":0},
    {"stop":0},{"stop":0},{"stop":0}
  ],
  "n":"Preset Name"
}
```

## Effect selection for slow ambient flow

| Effect | `fx` | Notes |
|---|---|---|
| Flow | 110 | Best slow organic movement through the palette. `sx=15, ix=5`. |
| Colorwaves | 67 | Wave-based; can create dark troughs at high speed. |
| Palette | 65 | Scrolls the palette linearly; `ix` = repetitions across the strip. |

For dark-patch-free ambient lighting: **Flow (`fx=110`), `sx=10–20`, `ix=4–8`**.

## Quick reference

```bash
source ~/.config/deckblaster.env
WLED="http://$WLED_SCHREIBTISCH_IP"

# Current segment state
curl -s "$WLED/json/state" | jq '.seg[0] | {fx,pal,sx,ix}'

# Device info (palcount, cpalcount)
curl -s "$WLED/json/info" | jq '{palcount,cpalcount,ver}'

# Unlock + list filesystem
curl -s -c /tmp/w.txt -b /tmp/w.txt -X POST "$WLED/settings/sec" -d "PIN=$PIN" >/dev/null
curl -s -c /tmp/w.txt -b /tmp/w.txt "$WLED/edit?list=/" | jq .

# Set effect + palette + speed
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" \
  -d '{"seg":[{"id":0,"fx":110,"pal":255,"sx":15,"ix":5}]}'

# Reboot
curl -s -X POST "$WLED/json/state" -H "Content-Type: application/json" -d '{"rb":true}'
```

## Citations

- [WLED JSON API](https://kno.wled.ge/interfaces/json-api/)
- [WLED Custom Palettes](https://kno.wled.ge/features/palettes/)
- [WLED 0.15.1 `index.js` — `updateSelectedPalette`](https://github.com/Aircoookie/WLED/blob/v0.15.1/wled00/data/index.js)
