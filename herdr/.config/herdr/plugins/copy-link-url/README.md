# Copy Link URL (Herdr plugin)

Herdr's right-click pane menu is built in and cannot be extended by plugins
(plugin v1 has no runtime menu registration). The supported extension point for
links is a **link handler**: Ctrl+click on a matching terminal URL runs a plugin
action with `HERDR_PLUGIN_CLICKED_URL` set, instead of opening the URL.

This plugin uses that hook to **copy the URL to the clipboard** on Ctrl+click.

## Behaviour

- Ctrl+hover a URL: Herdr underlines it (built in).
- Ctrl+click a URL: this plugin copies it to the clipboard and shows a toast.
- Any `http://` / `https://` URL matches, including the URL inside a rendered
  markdown link such as ``[docs](https://example.com/page)``.

Requires `ui.mouse_capture = true` (the Herdr default).

## Install

```bash
herdr plugin link ~/Dev/dot-files/herdr/.config/herdr/plugins/copy-link-url
herdr plugin list
```

## Remove

```bash
herdr plugin unlink local.copy-link-url
```
