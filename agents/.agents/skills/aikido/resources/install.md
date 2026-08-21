# Install / credentials

## 1. Create API client credentials (workspace admin only)

1. Open https://app.aikido.dev/settings/integrations/api/aikido/rest
2. Create a new API client (App type: *Private* / client credentials).
3. Grant the read scopes: `reports:read`, `issues:read`, `repositories:read`, `code_quality:read`
   (optionally `basics:read`, `teams:read`).
4. Copy the **Client ID** (`AIK_CLIENT_...`) and **Client Secret**.

## 2. Store them

Preferred (matches the other skills in this dotfiles repo) — add to `~/.env-private`:

```bash
export AIKIDO_CLIENT_ID="AIK_CLIENT_..."
export AIKIDO_CLIENT_SECRET="..."
# non-EU workspaces only:
# export AIKIDO_API_URL="https://app.us.aikido.dev"   # or app.me / app.au
```

Alternative file (used when the env vars are absent):

```bash
mkdir -p ~/.config/aikido
cat > ~/.config/aikido/credentials.json <<'JSON'
{ "clientId": "AIK_CLIENT_...", "clientSecret": "...", "apiUrl": "https://app.aikido.dev" }
JSON
chmod 600 ~/.config/aikido/credentials.json
```

## 3. Verify

```bash
bun ~/.agents/skills/aikido/scripts/aikido.ts repos
bun ~/.agents/skills/aikido/scripts/aikido.ts pr apheris/hub#2603
```

`pr` also works **without** Aikido credentials (GitHub check-run data only) — it reports the scan URL and
new/solved issue counts per severity.

## Requirements

- `bun`
- `gh` authenticated (only for the `pr` command)
