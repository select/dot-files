# Single-session flow syntax

Use `run.js` for navigation, interactions, assertions, and screenshots in one
session. For setup, shared CLI options, browser lifetime, and diagnostics, see
[SKILL.md](../SKILL.md).

```bash
# Run from the project root.
node ~/.pi/agent/skills/chrome-devtools/scripts/run.js \
  --flow /absolute/path/to/flow.json --output-dir "$PWD/docs/screenshots"
```

## Format

```json
{
  "steps": [
    { "action": "navigate", "url": "http://localhost:8081", "wait-for": "#ready" },
    { "action": "fill", "selector": "#search", "value": "protein" },
    { "action": "click", "selector": "button[type='submit']", "wait-for": "#results" },
    { "action": "assert", "name": "Results loaded", "expression": "document.querySelectorAll('#results li').length > 0" },
    { "action": "screenshot", "output": "results.png", "full-page": true, "scroll-top": true }
  ]
}
```

| Action | Fields | Behavior |
| --- | --- | --- |
| `navigate` | `url`; optional `wait-until`, `wait-for`, `delay` | Navigate, then wait for readiness |
| `click` | `selector`; optional `wait-navigation`, `wait-for`, `delay` | Navigation wait is opt-in and registered before clicking |
| `fill` | `selector`, `value`; optional `clear`, `type-delay`, `wait-for`, `delay` | Clears by default; `clear: false` appends |
| `drag` | `selector`, `from`, `to`; optional `toSelector`, `steps`, `wait-for`, `delay` | Real pointer drag; defaults to 20 movement steps |
| `wait` | `wait-for` and/or `delay` | Wait for a visible element, then delay |
| `assert` | `expression`; optional `name` | Poll until the expression returns exactly `true` |
| `evaluate` | `script` | Evaluate once and include the result in output |
| `screenshot` | `output`; optional screenshot flags from SKILL.md | Capture with readiness and compression settings |

A step's `timeout` overrides `--timeout`; `navigate` also inherits `--wait-until`.
Other per-action options belong on the step. `name` labels a step in reports.
Assertions support async expressions and should be side-effect-free because they
can run repeatedly. A failed step reports its index and name.

Relative screenshots resolve under `--output-dir`, or the flow file's directory if
omitted. Absolute paths are preserved.

## Drag coordinates

`from` and `to` are `[x,y]` fractions in `[0,1]` within the source/target element.
Without `toSelector`, both refer to `selector`.

```json
{
  "action": "drag",
  "selector": "(//*[@data-test='residue'])[10]",
  "toSelector": "(//*[@data-test='residue'])[20]",
  "from": [0.5, 0.5],
  "to": [0.5, 0.5]
}
```

The source scrolls into view before coordinates are measured. Both endpoints must
fit in the viewport; off-screen endpoints fail rather than producing a bad drag.

## Test-only response overrides

Overrides require `--allow-overrides`. Each matches an exact absolute HTTP(S) URL
and method (default `GET`); unmatched requests pass through untouched.

```json
{
  "overrides": [
    {
      "url": "http://localhost:8081/config.json",
      "body": "{\"VIEWER_ENABLED\":true,\"AUTH_ENABLED\":false}"
    }
  ],
  "steps": [
    { "action": "navigate", "url": "http://localhost:8081/viewer?demo=true" }
  ]
}
```

Optional fields: `method`, `status` (default 200), `contentType` (default
`application/json`), and `headers`. `body` must be a string; alternatively use
`bodyFile`, resolved relative to the flow file. Output reports override hit counts.
Disclose overrides when reporting verification; they do not validate the backend.

Flows fail on JavaScript page errors by default. Use `--fail-on-page-error false`
only when intentional. Console/network errors remain diagnostic information.

Adapt the sample flow to your application's routes and readiness selectors.
Keep project-specific fixtures and verification recipes in that project's repository.
