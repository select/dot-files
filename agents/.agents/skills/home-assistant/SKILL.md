---
name: home-assistant
description: Control Home Assistant devices, lights, switches, and media. Look up room/device states. Use when the user asks to turn on/off lights, check sensors, control media players, or interact with any smart home device. Also covers the WLED Schreibtisch strip (palettes, presets, PIN unlock).
---

# Home Assistant Skill

Use this skill whenever the user asks to control devices, lights, switches, media, or anything related to the smart home.

## MCP Tool Usage

All HA tools are accessed via the `mcp` proxy. Always use the full prefixed name:

```
mcp({ tool: "homeassistant_HassTurnOn",  args: '{"name": "...", "area": "..."}' })
mcp({ tool: "homeassistant_HassTurnOff", args: '{"name": "...", "area": "..."}' })
mcp({ tool: "homeassistant_GetLiveContext", args: '{}' })
mcp({ tool: "homeassistant_HassLightSet", args: '{"area": "...", "brightness": 80}' })
```

## Room Aliases → HA Area Names

When the user refers to a room, map it to the exact HA area name:

| User might say | HA Area Name |
|---|---|
| blue room, blaues zimmer, arbeitszimmer, büro, office | `Blaues Zimmer` |
| bad, bathroom, badezimmer | `Bad oben` |
| wohnzimmer, living room, lounge | `Wohnzimmer` |
| schlafzimmer, bedroom | `Schlafzimmer` |
| nila, nila's room, nila zimmer, kinderzimmer | `Nila Zimmer` |
| treppe, gang, staircase, hallway, flur | `Treppe Gang` |
| keller, basement, cellar | `Keller` |
| eingang, entrance, front door, flur unten | `Eingang` |
| küche, kitchen | `Küche` |
| draußen, outside, garden, exterior, garten | `Draußen` |

## Discovering Rooms and Devices

Never guess what rooms or devices exist — always call `GetLiveContext` first:

```
mcp({ tool: "homeassistant_GetLiveContext", args: '{}' })
```

The response lists every entity with its `areas` field. Extract unique area values to get all rooms.
Use device `names` and `domain` fields to find controllable entities within a room.

## WLED (Schreibtisch strip — not in HA)

The WLED desk strip is controlled directly over its own HTTP API (it is not a HA entity).

> **⚠️ READ FIRST:** before doing *anything* with WLED (palettes, presets, the `/edit`
> filesystem endpoint, the device PIN, or any state change), you **must** read
> [resource/wled.md](resource/wled.md). It documents the PIN/cookie unlock, the read-only
> `/json/cpal` trap, the `255-j` custom-palette index scheme, the upload/reboot flow, and
> the preset pitfalls — all of which silently fail or crash the web UI if ignored.

## Beyond MCP: REST API & WebSocket API

The MCP tools only cover basic device control. For **automations, dashboards, entity registry, integrations**, use the HA APIs directly.

### Credentials

```bash
source ~/.config/deckblaster.env   # provides HA_URL, HA_TOKEN, DECK_API
```

### REST API (automations, states, services)

```bash
# List all automations
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states" | \
  python3 -c "import json,sys; [print(s['entity_id'],'-',s['attributes'].get('friendly_name','')) for s in json.load(sys.stdin) if s['entity_id'].startswith('automation.')]"

# Get automation config (use the 'id' from entity attributes)
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/config/automation/config/<id>"

# Update automation config
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "$HA_URL/api/config/automation/config/<id>" -d '{...}'

# Trigger an automation
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "$HA_URL/api/services/automation/trigger" -d '{"entity_id": "automation.xxx"}'

# Call any service
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "$HA_URL/api/services/<domain>/<service>" -d '{...}'
```

### WebSocket API (dashboards, entity registry, integration reload)

The REST API does NOT work for Lovelace dashboards (returns 404). Use WebSocket:

```bash
export $(cat ~/.config/deckblaster.env | xargs) && uv run --with websockets python3 -c "
import asyncio, json, websockets, os

async def main():
    url = os.environ['HA_URL'].replace('http', 'ws') + '/api/websocket'
    token = os.environ['HA_TOKEN']
    async with websockets.connect(url) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({'type': 'auth', 'access_token': token}))
        await ws.recv()  # auth_ok

        # List dashboards
        await ws.send(json.dumps({'id': 1, 'type': 'lovelace/dashboards/list'}))
        result = json.loads(await ws.recv())
        print(result['result'])

asyncio.run(main())
"
```

**Key WebSocket commands:**

| Command | Purpose |
|---|---|
| `lovelace/dashboards/list` | List all dashboards |
| `lovelace/dashboards/create` | Create new dashboard (`url_path`, `title`, `icon`, `show_in_sidebar`) |
| `lovelace/config` (+ `url_path`) | Get dashboard config (**NOT** `lovelace/config/get` — that's wrong!) |
| `lovelace/config/save` (+ `url_path`, `config`) | Save dashboard config |
| `config/entity_registry/list` | List all entities in registry |
| `config/entity_registry/update` | Rename/disable entities |
| `config/entity_registry/remove` | Delete entity |

**Important:** The `websockets` module is not installed globally — always use `uv run --with websockets python3`.

## Tips

- Always resolve room aliases to the exact HA area name using the table above before calling any tool
- `GetLiveContext` is the source of truth for current state and available devices — use it when unsure
- `HassTurnOn` / `HassTurnOff` work for both lights and switches
- `HassLightSet` accepts `brightness` (0–100) and `color` (e.g. `"warm white"`, `"blue"`)
- Target by both `name` + `area` for precision, or just `area` to affect everything in a room
- The automation `id` is found in the entity's `attributes.id` field (numeric string)
