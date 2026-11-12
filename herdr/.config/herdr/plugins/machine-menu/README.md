# Machine Menu

A small Herdr popup to enable or disable saved SSH machines, including disabled
profiles that aren't available in the normal workspace list. Requires Herdr
0.9.5+ and Bun on PATH.

## Install

```sh
herdr plugin link "$HOME/Dev/dot-files/herdr/.config/herdr/plugins/machine-menu"
```

This dotfiles configuration binds **Ctrl+A, then M** to the menu:

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "local.machine-menu.open"
description = "enable / disable SSH machines"
```

Reload the client configuration with **Ctrl+A, then R** after adding the binding.
You can also open it from a terminal in the local Herdr session:

```sh
herdr plugin action invoke local.machine-menu.open
```

## Controls

- **Up/Down** or **J/K**: select a machine.
- **Enter**: enable or disable the selected machine.
- **R**: reread the saved-machine list.
- **Esc**, **Q**, or **Ctrl+C**: close.

ON/OFF shows the saved profile's enabled setting, not live connectivity.
Opening the menu only runs `machine list --json`: it does not probe hosts,
authenticate, or connect. Toggling uses the opaque profile ID and rereads the
current setting first. Failed mutations are not retried automatically; refresh
before trying again. Input is blocked while a command runs.

Enabling permits Herdr's normal background connection/reconnection. Disabling
disconnects clients without stopping remote sessions or agents. Settings persist
across Herdr restarts; close the menu and disable an optional host when finished
if it should not reconnect next time.

This is a **local-session plugin**: use it while Local is selected. Herdr runs
plugin actions on the selected server, not automatically on your laptop. It
does not add buttons to the native sidebar or change machine settings on startup.

## Test

```sh
bun test ./machines.test.ts
```
