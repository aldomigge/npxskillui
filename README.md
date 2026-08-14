<div align="center">
  <a href="https://skillui.vercel.app">
    <img src="skillui.png" alt="SkillUI" width="620" />
  </a>
  <br /><br />
  <p><strong>Reverse-engineer any design system into an agent-ready skill.<br/>Claude Code and Codex. Pure static analysis. No AI. No API keys.</strong></p>

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

**SkillUI** is a CLI that crawls any website, git repo, or local codebase and extracts its complete design system — colors, typography, spacing, animations, components, screenshots — into a reusable `SKILL.md` package.

SkillUI supports **Claude Code**, **Codex**, or both from the same extracted design skill. The extraction format remains agent-neutral; only installation/discovery differs by agent.

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

### Claude Code

```bash
skillui --url https://notion.so --agent claude
```

`claude` remains the default for backward compatibility, so this is equivalent to:

```bash
skillui --url https://notion.so
```

SkillUI keeps the existing Claude integration: it writes `CLAUDE.md` into the generated design folder and installs `SKILL.md` under `~/.claude/skills/<skill-name>/`.

### Codex

Run SkillUI from the repository where you want Codex to use the design skill:

```bash
skillui --url https://notion.so --agent codex
```

SkillUI installs the complete generated skill folder into:

```text
.agents/skills/<skill-name>/
```

Codex discovers repository skills from `.agents/skills`. The complete folder is installed so screenshots, references, tokens, fonts, and other assets remain available to the skill.

In Codex you can let the skill trigger automatically from its description, use `/skills`, or mention it explicitly with `$`.

### Claude Code + Codex

```bash
skillui --url https://notion.so --agent both
```

This generates one shared design skill and installs the appropriate integration for both agents without maintaining separate Claude/Codex copies of the design instructions.

---

## Agent integrations

| Agent | Flag | Installation/discovery |
|---|---|---|
| Claude Code | `--agent claude` | `~/.claude/skills/<name>/SKILL.md` + generated `CLAUDE.md` |
| Codex | `--agent codex` | `.agents/skills/<name>/` in the current project |
| Both | `--agent both` | Installs both integrations from the same generated skill |

`--agent claude` is the default to preserve the original SkillUI behavior.

SkillUI does **not** generate `AGENTS.md` for Codex. Codex discovers skills directly from `.agents/skills`; `AGENTS.md` remains available for repository-wide agent instructions when a project needs them, but it is not required for SkillUI design skills.

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

When connected over CDP, SkillUI reuses the browser's default context. SkillUI tracks the pages it creates so pre-existing tabs are left untouched, and disconnecting Playwright does not terminate the externally owned browser.

**CDP is the recommended fallback when bundled Chromium or `--browser chrome` produces blank, incomplete, blocked, or otherwise incorrect captures.**

For current Chrome versions, remote debugging should use a separate user-data directory. Example on Windows PowerShell:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\chrome-skillui-profile"
```

Verify the endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
```

Then run SkillUI:

```powershell
skillui `
  --url "https://example.com" `
  --mode ultra `
  --cdp-endpoint "http://127.0.0.1:9222" `
  --agent codex
```

`--cdp-endpoint` takes precedence over `--browser` and `--headed` because SkillUI is attaching to a browser that is already running.

When a custom browser runtime is selected (`--browser chrome`, `--headed`, or `--cdp-endpoint`), the homepage screenshot under `screenshots/` uses that configured Playwright runtime as well. With no custom browser flags, the original Microlink homepage screenshot behavior is preserved.

### Dir mode - local project scan

```bash
skillui --dir ./my-app
```

### Repo mode - clone and scan

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
| Agent-neutral `SKILL.md` | ✅ | ✅ |
| Claude Code integration | ✅ | ✅ |
| Codex `.agents/skills` integration | ✅ | ✅ |
| `.skill` ZIP packaged | ✅ | ✅ |
| 7 scroll journey screenshots | | ✅ |
| Hover / focus interaction diffs | | ✅ |
| CSS keyframes + animation detection | | ✅ |
| Flex/grid layout extraction | | ✅ |
| DOM component fingerprinting | | ✅ |

---

## Output Structure

Generated design package:

```text
notion-design/
├── notion-design.skill
├── SKILL.md
├── CLAUDE.md                 # generated for Claude/both
├── DESIGN.md
├── references/
│   ├── ANIMATIONS.md
│   ├── LAYOUT.md
│   ├── COMPONENTS.md
│   ├── INTERACTIONS.md
│   └── VISUAL_GUIDE.md
├── screens/
│   ├── scroll/
│   ├── pages/
│   └── sections/
├── tokens/
│   ├── colors.json
│   ├── spacing.json
│   └── typography.json
└── fonts/
```

With `--agent codex`, the complete folder is copied to the repository-scoped Codex location:

```text
.agents/
└── skills/
    └── notion-design/
        ├── SKILL.md
        ├── references/
        ├── screens/
        ├── tokens/
        └── fonts/
```

If `--out .agents/skills` is already used, SkillUI detects that the generated folder is already at the Codex discovery path and avoids copying it onto itself.

---

## All Flags

```text
skillui --url <url>           Crawl a live website
skillui --dir <path>          Scan a local project directory
skillui --repo <url>          Clone and scan a git repository

--mode ultra                  Enable cinematic extraction (requires Playwright)
--screens <n>                 Pages to crawl in ultra mode (default: 5, max: 20)
--browser chromium|chrome     Playwright browser to launch (default: chromium)
--headed                      Show the launched Playwright browser window
--cdp-endpoint <url>          Attach to an existing Chromium/Chrome browser over CDP
--agent claude|codex|both     Agent integration (default: claude)
--out <path>                  Output directory (default: ./)
--name <string>               Override the project name
--format design-md|skill|both Output format (default: both)
--no-skill                    Output DESIGN.md only, skip .skill packaging
```

---

## Examples

```bash
# Original behavior: Claude Code
skillui --url https://nothing.tech --mode ultra --screens 10

# Explicit Claude Code integration
skillui --url https://nothing.tech --mode ultra --agent claude

# Codex repository skill
skillui --url https://nothing.tech --mode ultra --agent codex

# Claude Code + Codex
skillui --url https://nothing.tech --mode ultra --agent both

# Codex + real Chrome over CDP
skillui \
  --url https://nothing.tech \
  --mode ultra \
  --cdp-endpoint http://127.0.0.1:9222 \
  --agent codex

# Generate directly into Codex's repository skill directory
skillui \
  --url https://nothing.tech \
  --mode ultra \
  --agent codex \
  --out .agents/skills \
  --name nothing

# Scan a local Next.js app
skillui --dir ./my-nextjs-app --name "MyApp"

# Clone and analyze a public repo
skillui --repo https://github.com/vercel/next.js --name "Next.js"
```

---

## How It Works

SkillUI performs its design extraction locally and does not use AI or require API keys. The legacy homepage screenshot path uses Microlink; custom browser runtimes capture that screenshot locally through Playwright.

- **URL mode** — fetches HTML, crawls CSS, and optionally extracts computed styles through Playwright
- **Dir mode** — scans local source files for tokens, components, Tailwind configuration, and CSS variables
- **Repo mode** — clones a public repository and runs dir mode
- **Ultra mode** — captures scroll screenshots, animation metadata, layout structure, interaction states, and DOM component patterns
- **Agent layer** — keeps the generated `SKILL.md` shared, then installs agent-specific discovery integration for Claude Code, Codex, or both
- **Codex integration** — copies the complete skill directory to `.agents/skills/<name>` and normalizes the skill `name` metadata for Codex discovery
- **Claude integration** — preserves the original `~/.claude/skills/<name>/SKILL.md` installation and `CLAUDE.md` generation

---

## Requirements

- Node.js 18+
- Playwright package for Playwright-backed extraction (`npm install playwright`)
- Bundled Chromium installation for the default Playwright flow (`npx playwright install chromium`)
- For `--browser chrome`: a compatible Google Chrome installation
- For `--cdp-endpoint`: an already-running Chromium-based browser with remote debugging enabled
- For `--agent codex`: run SkillUI from the repository/worktree where `.agents/skills` should be created

---

## Links

- [npm package](https://www.npmjs.com/package/skillui)
- [Landing page](https://skillui.vercel.app)
- [Source code](https://github.com/amaancoderx/npxskillui)
- [Issues](https://github.com/amaancoderx/npxskillui/issues)

---

## License

MIT - built by [Amaan](https://github.com/amaancoderx)
