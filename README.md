<div align="center">
  <a href="https://skillui.vercel.app">
    <img src="skillui.png" alt="SkillUI" width="620" />
  </a>
  <br /><br />
  <p><strong>Reverse-engineer any design system into a Claude-ready skill.<br/>Pure static analysis. No AI. No API keys.</strong></p>

  [![npm version](https://img.shields.io/npm/v/skillui?color=%23e8735a&label=skillui&style=flat-square)](https://www.npmjs.com/package/skillui)
  [![npm downloads](https://img.shields.io/npm/dm/skillui?color=%23e8735a&style=flat-square)](https://www.npmjs.com/package/skillui)
  [![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/amaancoderx/npxskillui/blob/main/LICENSE)
  [![GitHub repo](https://img.shields.io/badge/source-npxskillui-gray?style=flat-square&logo=github)](https://github.com/amaancoderx/npxskillui)

</div>

---

## One-shotted Notion's landing page in minutes with a single line prompt

https://github.com/user-attachments/assets/4d6b63f1-8042-44a2-8f4f-a92fedadcaf9

---

## What is SkillUI?

**SkillUI** is a CLI that crawls any website, git repo, or local codebase and extracts its complete design system - colors, typography, spacing, animations, components, screenshots - packaged into a folder Claude Code reads automatically.

Open the output folder, type `claude`, and ask Claude to build your UI. It already knows the exact design system.

---

## Install

```bash
npm install -g skillui
```

> Requires **Node.js 18+**

For browser-backed extraction, install Playwright:

```bash
npm install playwright
```

The default ultra-mode browser is Playwright's bundled Chromium, which also requires:

```bash
npx playwright install chromium
```

If you use `--browser chrome` or `--cdp-endpoint`, SkillUI can use an installed/existing Chromium-based browser instead of the bundled Chromium executable.

---

## Quick Start

```bash
# 1. Extract a design system from any URL
skillui --url https://notion.so

# 2. Open the output folder in Claude Code
cd notion-design && claude

# 3. Ask Claude to build your UI
"Build me a landing page that matches this design system"
```

Claude automatically reads `CLAUDE.md` and `SKILL.md` - no manual setup needed. It uses the extracted colors, typography, spacing, components, animations, and screenshots to generate an HTML file matching the exact visual language of the site.

---

## Modes

### Default mode - pure static analysis

Extracts HTML, CSS, fonts, color tokens, spacing, and typography. Works on any site, no browser required for the HTTP/CSS extraction path.

```bash
skillui --url https://linear.app
```

### Ultra mode - full cinematic extraction

Uses Playwright to capture scroll screenshots, interaction diffs, animation detection, layout analysis, and DOM component fingerprinting.

```bash
skillui --url https://linear.app --mode ultra
```

By default, all Playwright-backed extraction preserves the original behavior and launches bundled Chromium headlessly.

### Browser runtime options

SkillUI supports three browser strategies. Choose the simplest one that renders the target site correctly.

| Strategy | Command | Best for |
|---|---|---|
| Bundled Chromium | `--mode ultra` | Default, isolated and fully Playwright-managed extraction |
| Installed Chrome | `--browser chrome` | Chrome-specific rendering while still letting Playwright launch the browser |
| Existing browser via CDP | `--cdp-endpoint <url>` | Sites that render incorrectly in Playwright-launched browsers, existing sessions, or real browser environments |

#### Use installed Google Chrome

Use the system Chrome channel instead of Playwright's bundled Chromium:

```bash
skillui --url https://linear.app --mode ultra --browser chrome
```

Add `--headed` if you want the launched browser to be visible:

```bash
skillui --url https://linear.app --mode ultra --browser chrome --headed
```

`--browser chrome` still launches and controls Chrome through Playwright with a fresh Playwright-managed session. It is **not the same as attaching to a Chrome instance you started yourself**. If a site still renders incorrectly with `--browser chrome --headed`, use CDP.

#### Reuse an existing Chrome via CDP

For sites that render incorrectly when the browser is launched by Playwright, SkillUI can attach to an already-running Chromium-based browser through the Chrome DevTools Protocol (CDP):

```bash
skillui \
  --url https://example.com \
  --mode ultra \
  --cdp-endpoint http://127.0.0.1:9222
```

When connected over CDP, SkillUI reuses the browser's default context. This allows the extraction to run inside the externally launched browser environment. SkillUI tracks the pages it creates so pre-existing tabs are left untouched, and disconnecting Playwright does not terminate the externally owned browser.

**CDP is the recommended fallback when bundled Chromium or `--browser chrome` produces blank, incomplete, blocked, or otherwise incorrect captures.**

For current Chrome versions, remote debugging should use a separate user-data directory. Chrome 136+ does not honor `--remote-debugging-port` against the default Chrome data directory.

Example on Windows PowerShell:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\chrome-skillui-profile"
```

Verify that the endpoint is available:

```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
```

Then run SkillUI:

```powershell
skillui `
  --url "https://example.com" `
  --mode ultra `
  --cdp-endpoint "http://127.0.0.1:9222"
```

`--cdp-endpoint` takes precedence over `--browser` and `--headed` because SkillUI is attaching to a browser that is already running.

When a custom browser runtime is selected (`--browser chrome`, `--headed`, or `--cdp-endpoint`), the homepage screenshot under `screenshots/` uses that configured Playwright runtime as well. With no custom browser flags, the original Microlink homepage screenshot behavior is preserved.

### Dir mode - local project scan

Scans `.css`, `.scss`, `.ts`, `.tsx`, `.js`, `.jsx` for design tokens, Tailwind config, CSS variables, and component patterns.

```bash
skillui --dir ./my-app
```

### Repo mode - clone and scan

Clones any public git repository and runs dir mode automatically.

```bash
skillui --repo https://github.com/org/repo
```

---

## What You Get

| Feature | Default | Ultra |
|---|:---:|:---:|
| Color tokens (CSS vars + JSON) | ✅ | ✅ |
| Typography scale | ✅ | ✅ |
| Spacing grid | ✅ | ✅ |
| Google Fonts bundled locally | ✅ | ✅ |
| `CLAUDE.md` + `SKILL.md` auto-generated | ✅ | ✅ |
| `.skill` ZIP packaged | ✅ | ✅ |
| 7 scroll journey screenshots | | ✅ |
| Hover / focus interaction diffs | | ✅ |
| CSS keyframes + animation detection | | ✅ |
| Flex/grid layout extraction | | ✅ |
| DOM component fingerprinting | | ✅ |

---

## Output Structure

```
notion-design/
├── notion-design.skill       # Packaged .skill ZIP (contains everything)
├── SKILL.md                  # Master skill file (auto-loaded by Claude)
├── CLAUDE.md                 # Claude Code project context
├── DESIGN.md                 # Full design system tokens
├── references/
│   ├── ANIMATIONS.md         # Motion specs and keyframes
│   ├── LAYOUT.md             # Layout containers and grid
│   ├── COMPONENTS.md         # DOM component patterns
│   ├── INTERACTIONS.md       # Hover/focus state diffs
│   └── VISUAL_GUIDE.md       # All screenshots embedded in sequence
├── screens/
│   ├── scroll/               # 7 scroll journey screenshots
│   ├── pages/                # Full-page screenshots (ultra)
│   └── sections/             # Section clip screenshots (ultra)
├── tokens/
│   ├── colors.json
│   ├── spacing.json
│   └── typography.json
└── fonts/                    # Bundled Google Fonts (woff2)
```

---

## All Flags

```
skillui --url <url>           Crawl a live website
skillui --dir <path>          Scan a local project directory
skillui --repo <url>          Clone and scan a git repository

--mode ultra                  Enable cinematic extraction (requires Playwright)
--screens <n>                 Pages to crawl in ultra mode (default: 5, max: 20)
--browser chromium|chrome     Playwright browser to launch (default: chromium)
--headed                      Show the launched Playwright browser window
--cdp-endpoint <url>          Attach to an existing Chromium/Chrome browser over CDP
--out <path>                  Output directory (default: ./)
--name <string>               Override the project name
--format design-md|skill|both Output format (default: both)
--no-skill                    Output DESIGN.md only, skip .skill packaging
```

---

## Examples

```bash
# Full ultra extraction - Nothing.tech
skillui --url https://nothing.tech --mode ultra --screens 10

# Same extraction using installed Google Chrome launched by Playwright
skillui --url https://nothing.tech --mode ultra --browser chrome --headed

# Recommended fallback for sites that do not render correctly above
skillui --url https://nothing.tech --mode ultra --cdp-endpoint http://127.0.0.1:9222

# Scan a local Next.js app
skillui --dir ./my-nextjs-app --name "MyApp"

# Clone and analyze a public repo
skillui --repo https://github.com/vercel/next.js --name "Next.js"

# Output only DESIGN.md, no .skill packaging
skillui --url https://stripe.com --format design-md

# Save to a specific directory
skillui --url https://linear.app --out ./design-systems
```

---

## Package Info

<div align="center">

| | |
|---|---|
| **Package** | [npmjs.com/package/skillui](https://www.npmjs.com/package/skillui) |
| **Latest version** | `1.3.4` |
| **First published** | April 8, 2026 |
| **Last updated** | April 10, 2026 |
| **License** | MIT |
| **Author** | [Amaan](https://github.com/amaancoderx) |
| **Homepage** | [skillui.vercel.app](https://skillui.vercel.app) |
| **Issues** | [GitHub Issues](https://github.com/amaancoderx/npxskillui/issues) |

</div>

### Version History

<details>
<summary>View all 25 releases</summary>

| Version | Released |
|---|---|
| `1.3.4` ⬅ latest | May 8, 2026 |
| `1.3.3` | May 8, 2026 |
| `1.3.2` | April 10, 2026 |
| `1.3.1` | April 10, 2026 |
| `1.3.0` | April 10, 2026 |
| `1.2.9` | April 10, 2026 |
| `1.2.8` | April 10, 2026 |
| `1.2.7` | April 10, 2026 |
| `1.2.6` | April 10, 2026 |
| `1.2.5` | April 10, 2026 |
| `1.2.4` | April 10, 2026 |
| `1.2.3` | April 10, 2026 |
| `1.2.2` | April 10, 2026 |
| `1.2.1` | April 9, 2026 |
| `1.2.0` | April 9, 2026 |
| `1.1.9` | April 9, 2026 |
| `1.1.8` | April 9, 2026 |
| `1.1.7` | April 9, 2026 |
| `1.1.6` | April 9, 2026 |
| `1.1.5` | April 8, 2026 |
| `1.1.4` | April 8, 2026 |
| `1.1.3` | April 8, 2026 |
| `1.1.2` | April 8, 2026 |
| `1.1.1` | April 8, 2026 |
| `1.1.0` | April 8, 2026 |

</details>

---

## How It Works

SkillUI performs its design extraction locally and does not use AI or require API keys. The legacy homepage screenshot path uses Microlink; custom browser runtimes capture that screenshot locally through Playwright.

- **URL mode** - fetches HTML, crawls all linked CSS files, extracts computed styles via Playwright DOM inspection
- **Dir mode** - scans `.css`, `.scss`, `.ts`, `.tsx`, `.js`, `.jsx` for design tokens, Tailwind config, CSS variables, and component patterns
- **Repo mode** - clones the repo to a temp directory and runs dir mode
- **Ultra mode** - runs Playwright to capture scroll screenshots, detect animation libraries from `window.*` globals, extract `@keyframes` from `document.styleSheets`, capture hover/focus state diffs, fingerprint DOM components
- **Browser runtime** - defaults to bundled headless Chromium, can launch installed Chrome, or attach to an existing Chromium-based browser over CDP

---

## Requirements

- Node.js 18+
- Playwright package for Playwright-backed extraction (`npm install playwright`)
- Bundled Chromium installation for the default Playwright flow (`npx playwright install chromium`)
- For `--browser chrome`: a compatible Google Chrome installation
- For `--cdp-endpoint`: an already-running Chromium-based browser with remote debugging enabled; current Chrome versions should use a non-default `--user-data-dir`

---

## Links

- [npm package](https://www.npmjs.com/package/skillui)
- [Landing page](https://skillui.vercel.app)
- [Source code](https://github.com/amaancoderx/npxskillui)
- [Issues](https://github.com/amaancoderx/npxskillui/issues)

---

## License

MIT - built by [Amaan](https://github.com/amaancoderx)
