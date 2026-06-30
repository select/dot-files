---
type: Playbook
title: WLED API Editing — Palettes, Presets & Pitfalls
description: How to create and edit WLED custom palettes and presets via the HTTP API, including all the non-obvious failure modes encountered with ESP8266 WLED 0.15.1.
tags: [wled, led, smart-home, api, schreibtisch]
timestamp: 2026-06-30T00:00:00Z
---

# Overview

WLED exposes a JSON API and a filesystem editor (`/edit`) for full programmatic control.
The "Schreibtisch" device runs WLED **0.15.1** on an **ESP8266** with 80 LEDs.
The IP is stored in `~/.config/deckblaster.env` as `WLED_SCHREIBTISCH_IP`.

Interacting with WLED via the API has several non-obvious pitfalls, especially around custom
palettes, preset structure, and the mismatch between firmware and web-UI indexing.

---

# Authentication

> **Note on palette naming:** WLED does not support naming custom palettes. In the UI they always appear as `~ Custom 0 ~`, `~ Custom 1 ~`, etc. The human name lives in the **preset**, not the palette file.

---

# Authentication

The `/edit` filesystem endpoint requires a PIN unlock — it does **not** use HTTP Basic Auth.
Unlock by POSTing to `/settings/sec` with the PIN as a form field, which sets a session cookie.

```bash
# Read IP from env file
WLED_IP=$(grep WLED_SCHREIBTISCH_IP ~/.config/deckblaster.env | cut -d= -f2)

curl -c /tmp/wled.txt -b /tmp/wled.txt \
  -X POST http://$WLED_IP/settings/sec -d "PIN=<pin>"

# Then pass the cookie jar to all subsequent /edit requests
curl -c /tmp/wled.txt -b /tmp/wled.txt "http://$WLED_IP/edit?list=/"
```

The `/json/state` and `/json/info` endpoints require **no auth**.

The correct upload endpoint is `/upload` (multipart POST), **not** `/edit`.
`/edit` is for reading and deleting; `/upload` is for writing files.
The form field name must be **`data`** (matching what `cpal.htm` uses):

```bash
curl -c /tmp/wled.txt -b /tmp/wled.txt \
  -X POST http://WLED_IP/upload \
  -F "data=@/tmp/palette0.json;filename=/palette0.json"
```

---

# Custom Palettes

## File Format

Custom palettes are stored on the SPIFFS filesystem as `/palette0.json` through `/palette7.json`.
Format is a flat array of alternating `position` (0–255) and `"rrggbb"` hex strings:

```json
{"palette":[0,"714550", 64,"8e9dba", 128,"af6365", 255,"fbe7dd"]}
```

Up to 16 stops per palette. The gradient wraps — first and last colors should transition
gracefully or the wrap-point will be visible as a jump.

## ⚠️ Pitfall: Custom palette indices count down from 255

Both the firmware and the web UI (`index.js`) use the **same** index scheme for custom palettes —
counting down from 255. With the built-in palette list ending at index 70:

| File | Index to use |
|------|--------------|
| `palette0.json` | **255** |
| `palette1.json` | **254** |
| `palette2.json` | **253** |

All custom palette files load correctly on ESP8266 (confirmed with `cpalcount: 3`,
all three slots responding to their respective `255`/`254`/`253` index).

Setting `pal: 71/72/73` (sequential from end of built-ins) does **not** work — those
indices resolve to nothing and the value silently reverts to `0` (Default palette).

```
TypeError: can't access property "querySelector", n is null
```
This crash occurs when a preset stores the wrong index (e.g. `pal: 71`), because
`updateSelectedPalette(71)` searches for `.lstI[data-id="71"]` which doesn't exist in the DOM.

**Rule:** Always use `pal: 255` for `palette0.json`, `pal: 254` for `palette1.json`, etc.

## Reboot required after palette file change

Palette files are read at startup. Uploading a new `/palette0.json` has no effect until the
device reboots:

```bash
curl -s -X POST http://WLED_IP/json/state \
  -H "Content-Type: application/json" \
  -d '{"rb": true}'
```

---

# Presets

## Reading & Writing

Read all presets directly from the filesystem (requires auth):

```bash
curl -c /tmp/wled.txt -b /tmp/wled.txt \
  "http://WLED_IP/edit?edit=/presets.json"
```

Save the current state as a named preset via the API (no auth needed):

```bash
# 1. Apply desired state
curl -X POST http://WLED_IP/json/state \
  -H "Content-Type: application/json" \
  -d '{"seg":[{"id":0,"fx":110,"pal":255,"sx":15,"ix":5}]}'

# 2. Save as preset (separate call — doing both in one call can race)
curl -X POST http://WLED_IP/json/state \
  -H "Content-Type: application/json" \
  -d '{"psave": 11, "n": "My Preset"}'
```

## ⚠️ Pitfall: psave in the same call as seg produces incomplete presets

Combining `psave` with `seg` changes in one JSON body causes the preset to be saved **before**
the segment state is fully applied. The result: the new `fx`/`pal`/`sx` values are saved
correctly but `pal` reverts to `0` and other fields may be missing. Always use two separate calls.

## ⚠️ Pitfall: Preset segment structure must be complete (16 segments)

A preset saved via `psave` only captures the fields you explicitly sent — it omits `start`,
`stop`, and the 15 padding `{"stop":0}` entries that the web UI expects for each of the 16
possible segment slots.

The web UI iterates all segment slots and crashes if the structure is incomplete:

```
TypeError: can't access property "querySelector", n is null
```

When writing presets directly to `presets.json`, copy the full segment structure from a
working preset. The required shape for each preset entry:

```json
{
  "mainseg": 0,
  "seg": [
    {
      "id": 0, "start": 0, "stop": 80,
      "grp": 1, "spc": 0, "of": 0,
      "on": true, "frz": false,
      "bri": 255, "cct": 127, "set": 0,
      "col": [[255,160,0],[0,0,0],[0,0,0]],
      "fx": 110, "sx": 15, "ix": 5, "pal": 255,
      "c1": 128, "c2": 128, "c3": 16,
      "sel": true, "rev": false, "mi": false,
      "o1": false, "o2": false, "o3": false,
      "si": 0, "m12": 1
    },
    {"stop":0}, {"stop":0}, {"stop":0}, {"stop":0},
    {"stop":0}, {"stop":0}, {"stop":0}, {"stop":0},
    {"stop":0}, {"stop":0}, {"stop":0}, {"stop":0},
    {"stop":0}, {"stop":0}, {"stop":0}
  ],
  "n": "Preset Name"
}
```

---

# Palette Design for Ambient Lighting

## Avoid near-black colors

Colors with brightness < ~40 (e.g., `#1f161c`, `#402e3a`) will appear as dead/dark patches
on the strip. Remove them from palettes intended for continuous ambient use.

## Smooth looping

The palette gradient wraps: the last stop transitions back to the first. For seamless looping,
make the first and last stops similar in brightness and hue.

## Effect selection for slow smooth flow

| Effect | `fx` | Notes |
|--------|------|-------|
| Flow | 110 | Best for slow organic movement through palette. `sx=15, ix=5` matches "Flow organgery" pace. |
| Colorwaves | 67 | Wave-based; can create dark troughs between wave peaks at high speed. |
| Palette | 65 | Scrolls the palette linearly; `ix` controls how many palette repetitions fit the strip. |

For a slow, dark-patch-free ambient effect: **Flow (`fx=110`), `sx=10–20`, `ix=4–8`**.

---

# Quick Reference

```bash
# IP is in ~/.config/deckblaster.env as WLED_SCHREIBTISCH_IP
WLED=http://$(grep WLED_SCHREIBTISCH_IP ~/.config/deckblaster.env | cut -d= -f2)


# Current state
curl -s $WLED/json/state | jq '.seg[0] | {fx,pal,sx,ix}'

# List filesystem
curl -s -c /tmp/w.txt -b /tmp/w.txt "$WLED/edit?list=/"

# Set palette slot + effect + speed
curl -s -X POST $WLED/json/state \
  -H "Content-Type: application/json" \
  -d '{"seg":[{"id":0,"fx":110,"pal":255,"sx":15,"ix":5}]}'

# Save current state as preset 11
curl -s -X POST $WLED/json/state \
  -H "Content-Type: application/json" \
  -d '{"psave":11,"n":"Evening Clouds"}'

# Activate preset
curl -s -X POST $WLED/json/state \
  -H "Content-Type: application/json" \
  -d '{"ps":11}'

# Reboot
curl -s -X POST $WLED/json/state \
  -H "Content-Type: application/json" \
  -d '{"rb":true}'
```

# Citations

- [WLED JSON API docs](https://kno.wled.ge/interfaces/json-api/)
- [WLED Custom Palettes](https://kno.wled.ge/features/palettes/)
- [WLED 0.15.1 index.js source — `updateSelectedPalette`](https://github.com/Aircoookie/WLED/blob/v0.15.1/wled00/data/index.js)
