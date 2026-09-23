# Zoom meeting scheduling and diagnostics

Keep the normal Hyprland/4K desktop and development processes running while giving
Zoom and desktop services more CPU scheduling weight under contention. This is a
mitigation for CPU starvation, not a fix for application or capture bugs.

## Components

- `~/.local/bin/zoom-meeting`: launches the vendor `/usr/bin/zoom` in a transient
  systemd user service under `meetings.slice`. Forwards URL arguments unchanged
  and preserves the native-Wayland environment workaround. `ExitType=cgroup`
  keeps the service alive while Zoom's children remain alive.
- `~/.local/share/applications/Zoom.desktop`: routes app-menu and meeting-link
  launches through the wrapper, even when the desktop PATH lacks `~/.local/bin`.
  Direct `/usr/bin/zoom` launches bypass it; use `zoom-meeting` from a terminal.
- `meetings.slice`: CPU weight 300, compared with the normal `app.slice` weight 100.
- `session.slice` drop-in: CPU weight 200 to protect desktop/audio/capture services.
- Hyprland portal service drop-in: CPU weight 300 within `session.slice`.
- `zoom-diagnostics.service`: starts with the wrapper and exits after 60 seconds
  without a detected Zoom process. It is not enabled at login. Runs at nice 10 in
  `background.slice`, with CPU weight 10.

Weights are relative among sibling cgroups, not percentages or reserved cores.
They do not impose a CPU quota. Work launched outside the user service manager
(e.g. in the login session's cgroup) competes at a different level; these weights
are not a global priority guarantee. No real-time policy or negative nice values
are used. The session/portal weights persist while installed, even outside Zoom;
otherwise idle groups do not consume an allocation.

Requires systemd >= 250, Bash, Python 3 standard library, `pw-dump`, `dbus-monitor`,
and the vendor Zoom package. No Python package installation is needed.

## Install

Back up an existing `~/.local/share/applications/Zoom.desktop` before stowing;
do not overwrite local customizations blindly.

```sh
stow --no-folding -t ~ zoom
systemctl --user daemon-reload
# Apply to already-running cgroups without restarting the portal or audio:
systemctl --user set-property --runtime session.slice CPUWeight=200
systemctl --user set-property --runtime xdg-desktop-portal-hyprland.service CPUWeight=300
update-desktop-database ~/.local/share/applications
```

The runtime assignments take effect immediately; the checked-in drop-ins retain
those values after login/reboot. `daemon-reload` alone was insufficient to update
the already-running cgroups during initial installation.

## Diagnostics

`~/.local/state/zoom-meeting/diagnostics.log` and up to three rotated files:
8 MiB per file, approximately 32 MiB total. Files are private (0600).

- Every 3 seconds: per-process CPU (100% = one logical CPU), RSS, target cgroups,
  top eight user processes by CPU, pressure metrics and cumulative paging counters.
- Every 6 seconds: changed video/Zoom/portal PipeWire node states and negotiated
  Format/Buffers parameters exposed by `pw-dump`.
- Live: selected portal/PipeWire journal errors and D-Bus session/capture message
  headers. D-Bus payloads, meeting URLs, command-line arguments and media content
  are not collected. Native journal error strings are retained, so review before
  publishing logs. Standard logs may not expose the selected SHM/DMA-BUF type;
  additional targeted tracing may be needed to prove buffer negotiation.

```sh
systemctl --user status zoom-diagnostics
systemctl --user list-units 'zoom-workplace-*'
tail -f ~/.local/state/zoom-meeting/diagnostics.log
```

The original desktop entry and capture configuration were saved under
`~/.local/state/zoom-meeting/backup-20260914-162027/` on this machine.

## Test sequence

1. Launch from the app menu, a meeting link, or `zoom-meeting`. Enable the usual
   camera and full-screen share with normal development work running.
2. Keep existing SHM/capture FPS settings for the baseline. Note when sharing
   begins, stops unexpectedly, or is stopped deliberately.
3. Stop sharing before changing the portal configuration. Test
   `force_shm = false` in `~/.config/hypr/xdph.conf`, restart **only**
   `xdg-desktop-portal-hyprland`, and restart the diagnostic collector to record
   the new configuration. Never restart PipeWire during a meeting.
4. Retry sharing several times to check for the historical second-share black
   screen. Verify negotiation rather than assuming DMA-BUF was selected.
5. Restore `force_shm = true` if the experiment fails. A portal restart ends any
   other active portal screen captures, including browser shares/recordings.

The live `xdph.conf` is currently a separate regular file from the repository copy
under `hyprland/`; promote only tested changes to both. This package intentionally
does not change capture FPS, display resolution, camera quality, or video effects.

## Findings from the 2026-09-14 live test

- Normal sharing negotiated 3840×2160 BGRA with `maxFramerate=15`, despite the
  previously reported 10 FPS setting inside Zoom.
- The active external camera was capturing 1920×1080 MJPEG at 30 FPS.
- Zoom showed a high-CPU warning with the scheduling weights correctly applied;
  the capture stream remained running at that moment. We have not yet captured
  the originally reported spontaneous share termination.
- `force_shm=false` negotiated a DRM modifier and opened DMA-BUF FDs in both Zoom
  and XDPH, but Presenter layout → Content only displayed blank content.
- Restoring `force_shm=true` restored the desktop in that same preview. Keep SHM
  enabled for the tested Zoom 7.0.5 setup. Do not interpret the lower CPU during
  blank sharing as a usable performance improvement.
- Zoom used roughly 119% CPU with the camera on and screen sharing stopped, and
  approximately 156–215% during working sharing in varying workloads (100% is
  one logical CPU). These are diagnostic samples, not a controlled benchmark.
- After updating to Zoom 7.1.5.4332, the user confirmed that the green-bar preview
  control works. SHM sharing still negotiated 4K/max15fps. A CPU sample was about
  128%, but the active camera had changed to 720×1280 MJPEG30 (portrait), so this
  cannot be attributed to the update alone. DMA-BUF has not been retested on 7.1.5.

## Rollback

Quit Zoom normally first (do not stop its service while a meeting is active).

```sh
systemctl --user stop zoom-diagnostics.service
stow -D -t ~ zoom
systemctl --user daemon-reload
systemctl --user set-property --runtime session.slice CPUWeight=100
systemctl --user set-property --runtime xdg-desktop-portal-hyprland.service CPUWeight=100
```

Restore the saved desktop entry to `~/.local/share/applications/Zoom.desktop`, then
run `update-desktop-database ~/.local/share/applications`. No packages or capture
settings are changed by this rollback. The remaining inactive `meetings.slice`
uses no CPU and disappears when the user manager exits. Runtime weight overrides
expire at user-manager shutdown.
