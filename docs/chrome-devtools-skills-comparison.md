# Chrome DevTools Agent Skills — Comparison

> Researched March 2026. Sources: skills.sh leaderboard, pi.dev/packages, direct skill inspection.

## Skills Evaluated

| # | Skill | Source | Install |
|---|-------|--------|---------|
| 1 | `chrome-devtools` | `github/awesome-copilot` | `npx skills add github/awesome-copilot@chrome-devtools` |
| 2 | `chrome-devtools` | `chromedevtools/chrome-devtools-mcp` | `npx skills add chromedevtools/chrome-devtools-mcp@chrome-devtools` |
| 3 | `cc_chrome_devtools_mcp_skill` | `justfinethanku/cc_chrome_devtools_mcp_skill` | `npx skills add justfinethanku/cc_chrome_devtools_mcp_skill@cc_chrome_devtools_mcp_skill` |
| 4 | `chrome-devtools` | `mrgoonie/claudekit-skills` | `npx skills add mrgoonie/claudekit-skills@chrome-devtools` |

---

## Feature Comparison Table

| Feature | awesome-copilot | chromedevtools (official) | cc_chrome_devtools | mrgoonie/claudekit |
|---------|:-:|:-:|:-:|:-:|
| **Installs** | 7.5K | 872 | 15 | — |
| **Engine** | MCP | MCP | MCP | Puppeteer scripts |
| **Requires MCP setup** | ✅ | ✅ | ✅ | ❌ self-contained |
| **Total size** | ~4 KB | ~2 KB | ~116 KB | ~236 KB |
| **File count** | 1 | 1 | 5 | 25 |
| **Executable scripts** | ❌ | ❌ | ❌ | ✅ 12 `.js` scripts |
| **Navigation & page mgmt** | ✅ | ✅ | ✅ | ✅ |
| **Click / fill / interact** | ✅ | ✅ | ✅ | ✅ |
| **Screenshots** | ✅ | ✅ | ✅ | ✅ + auto-compress |
| **Console log inspection** | ✅ | ✅ | ✅ | ✅ |
| **Network request analysis** | ✅ | ✅ | ✅ | ✅ |
| **JS evaluation in page** | ✅ | ✅ | ✅ | ✅ |
| **Performance tracing** | ✅ | ✅ | ✅ | ✅ |
| **Core Web Vitals** | ✅ | ✅ | ✅ detailed | ✅ |
| **Device / network emulation** | ✅ | ✅ | ✅ | ✅ |
| **Accessibility tree (a11y)** | ✅ | ✅ | ✅ | ✅ via snapshot.js |
| **Drag & drop** | ✅ | ✅ | ✅ | ❌ |
| **File upload** | ✅ | ✅ | ✅ | ❌ |
| **Dialog handling** | ✅ | ✅ | ✅ | ❌ |
| **Persistent browser session** | via MCP | via MCP | via MCP | ✅ launch-persistent.js |
| **Auto image compression** | ❌ | ❌ | ❌ | ✅ ImageMagick |
| **Reference docs bundled** | ❌ | ❌ | ✅ TOOLS/WORKFLOWS/METRICS | ✅ CDP domains, Puppeteer API, Perf Guide |
| **CDP protocol reference** | ❌ | ❌ | ❌ | ✅ 47 domains |
| **Workflow patterns** | ✅ 3 | ✅ 3 | ✅ 6+ | ✅ with examples |
| **Linux/WSL setup guide** | ❌ | ❌ | ❌ | ✅ install-deps.sh |
| **Security — Gen AI** | ⚠️ High Risk | ✅ Safe | ✅ Safe | ⚠️ Med Risk |
| **Security — Socket** | ✅ 0 alerts | ✅ 0 alerts | ✅ 0 alerts | ✅ 0 alerts |
| **Security — Snyk** | ⚠️ Med Risk | ⚠️ Med Risk | ✅ Safe | ⚠️ High Risk |
| **License** | MIT | MIT | MIT | Apache-2.0 |

---

## Architectural Difference

Skills **1–3** are *knowledge files* — they teach the agent the vocabulary and workflow patterns for the **`chrome-devtools-mcp` MCP server**. The MCP server must be pre-configured in the agent's tool config; the skill itself just provides prompting context.

Skill **4 (mrgoonie)** is a *self-contained toolkit* — it ships **actual Puppeteer Node.js scripts** the agent executes directly via bash. No MCP dependency at all, but requires a one-time setup:

```bash
cd .claude/skills/chrome-devtools/scripts
./install-deps.sh   # Linux/WSL only
npm install
```

---

## Scores (1–10)

| Skill | Feature Completeness | Ease of Use | Documentation | Self-contained | Overall |
|-------|:---:|:---:|:---:|:---:|:---:|
| awesome-copilot | 8 | **10** | 8 | 3 | **7.5** |
| chromedevtools (official) | 7 | 9 | 6 | 3 | 6.5 |
| cc_chrome_devtools | 9 | 7 | **10** | 3 | 7.5 |
| mrgoonie/claudekit | **10** | 7 | **10** | **10** | **9.3** |

---

## Summary & Recommendations

### 🥇 Best daily driver (MCP already configured)
**`github/awesome-copilot@chrome-devtools`**

Single 97-line SKILL.md. Clean, well-structured, covers every major capability. 7.5K installs means it's the most battle-tested. Zero friction if `chrome-devtools-mcp` is already in your MCP config.

```bash
npx skills add github/awesome-copilot@chrome-devtools -g -y
```

---

### 🏆 Most feature-complete & self-contained
**`mrgoonie/claudekit-skills@chrome-devtools`**

Ships real Puppeteer scripts, reference docs for the full CDP protocol (47 domains), Puppeteer API, and a performance guide. Works with zero MCP configuration — the agent just calls the scripts via bash. Includes auto-compression for screenshots (relevant for Claude/Gemini 5MB API limits), persistent browser sessions, and error recovery patterns. Best choice for CI/CD, headless environments, or anywhere MCP can't be pre-configured.

```bash
npx skills add mrgoonie/claudekit-skills@chrome-devtools -g -y
```

---

### 📚 Best technical reference
**`justfinethanku/cc_chrome_devtools_mcp_skill`**

All 27 MCP tools documented with parameters and examples. Separate WORKFLOWS.md, METRICS.md (Core Web Vitals thresholds), and TOOLS.md. Good companion to keep around if you want to know exactly what a tool does without checking the MCP docs.

```bash
npx skills add justfinethanku/cc_chrome_devtools_mcp_skill@cc_chrome_devtools_mcp_skill -g -y
```

---

## My Setup (dot-files context)

The `chrome-devtools` MCP server is already configured in `opencode/.config/opencode/opencode.jsonc`. Given that, the recommended stack is:

1. **Install `awesome-copilot`** for day-to-day agent prompting context
2. **Keep `mrgoonie/claudekit-skills`** available as the power-tool fallback — its scripts can be invoked directly when the MCP server isn't responding or you need Puppeteer-level control

```bash
npx skills add github/awesome-copilot@chrome-devtools -g -y
npx skills add mrgoonie/claudekit-skills@chrome-devtools -g -y
```
