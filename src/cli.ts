import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { runDirMode } from './modes/dir.js';
import { runRepoMode } from './modes/repo.js';
import { runUrlMode } from './modes/url.js';
import { runUltraMode } from './modes/ultra.js';
import { parseResponsiveViewports } from './extractors/ultra/responsive.js';
import { generateDesignMd } from './writers/design-md.js';
import { generateSkill } from './writers/skill.js';
import { finalizeGeneratedSkill } from './writers/skill-finalizer.js';
import { embedResponsiveEvidenceInSkill } from './writers/responsive-skill.js';
import { compactGeneratedSkill, parseSkillContextMode } from './writers/skill-context.js';
import { configurePlaywrightBrowser } from './playwright-loader.js';
import { installAgentIntegrations } from './agents/index.js';
import { promptAgentTarget, showAgentLogo, showAgentResults } from './agents/ui.js';
import { CLIOptions, DesignProfile } from './types.js';
import {
  VERSION,
  showMissionBrief,
  startSpinner,
  succeedSpinner,
  failSpinner,
  warnLine,
  showUltraPlaywrightError,
  runInteractivePrompts,
} from './ui.js';

type ResponsiveCLIOptions = CLIOptions & { viewports?: string; skillContext?: string };

const program = new Command();

program
  .name('skillui')
  .description('Reverse-engineer design systems from any project. Pure static analysis — no AI, no API keys.')
  .version(VERSION)
  .option('--dir <path>', 'Scan a local project directory')
  .option('--repo <url>', 'Clone and scan a git repository')
  .option('--url <url>', 'Crawl a live website')
  .option('--out <path>', 'Output directory', './')
  .option('--name <string>', 'Override project name')
  .option('--no-skill', 'Output DESIGN.md only, skip .skill packaging')
  .option('--format <format>', 'Output format: design-md | skill | both', 'both')
  .option('--mode <mode>', 'Extraction mode: default | ultra', 'default')
  .option('--screens <number>', 'Ultra mode: max pages to crawl (default: 5)', '5')
  .option('--viewports <list>', 'Ultra mode: optional responsive samples, e.g. 390x844,768x1024,1440x900')
  .option('--browser <browser>', 'Playwright browser: chromium | chrome', 'chromium')
  .option('--headed', 'Run a launched Playwright browser with a visible window', false)
  .option('--cdp-endpoint <url>', 'Connect to an existing Chromium/Chrome browser over CDP')
  .option('--agent <agent>', 'Agent integration: claude | codex | both', 'claude')
  .option('--skill-context <mode>', 'Generated SKILL.md context: full | compact', 'full')
  .action(async (opts: ResponsiveCLIOptions) => {
    await showAgentLogo();

    const modes = [opts.dir, opts.repo, opts.url].filter(Boolean);

    if (modes.length === 0) {
      const answers = await runInteractivePrompts();
      if (!answers) process.exit(0);
      opts.url = answers.source === 'url' ? answers.target : undefined;
      opts.dir = answers.source === 'dir' ? answers.target : undefined;
      opts.repo = answers.source === 'repo' ? answers.target : undefined;
      opts.mode = answers.mode;
      opts.out = answers.out || './';
      opts.agent = await promptAgentTarget(opts.agent);
    } else if (modes.length > 1) {
      console.error('  Error: Specify only one of --dir, --repo, or --url\n');
      process.exit(1);
    }

    if (!['chromium', 'chrome'].includes(opts.browser)) {
      console.error(`  Error: Unsupported browser "${opts.browser}". Use chromium or chrome.\n`);
      process.exit(1);
    }

    if (!['claude', 'codex', 'both'].includes(opts.agent)) {
      console.error(`  Error: Unsupported agent "${opts.agent}". Use claude, codex, or both.\n`);
      process.exit(1);
    }

    let skillContext: ReturnType<typeof parseSkillContextMode>;
    try {
      skillContext = parseSkillContextMode(opts.skillContext);
    } catch (error: any) {
      console.error(`  Error: ${error.message || error}\n`);
      process.exit(1);
    }

    let responsiveViewports: ReturnType<typeof parseResponsiveViewports> = [];
    try {
      responsiveViewports = parseResponsiveViewports(opts.viewports);
    } catch (error: any) {
      console.error(`  Error: ${error.message || error}\n`);
      process.exit(1);
    }

    if (opts.cdpEndpoint) {
      try {
        const cdpUrl = new URL(opts.cdpEndpoint);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(cdpUrl.protocol)) throw new Error('unsupported protocol');
      } catch {
        console.error('  Error: --cdp-endpoint must be a valid http(s) or ws(s) URL.\n');
        process.exit(1);
      }
    }

    configurePlaywrightBrowser({
      browser: opts.browser,
      headed: opts.headed,
      cdpEndpoint: opts.cdpEndpoint,
    });

    const target = opts.url || opts.dir || opts.repo || '';
    showMissionBrief(opts.mode || 'default', target, path.resolve(opts.out));

    try {
      let profile: DesignProfile;
      let screenshotPath: string | null = null;

      const outputDir = path.resolve(opts.out);
      fs.mkdirSync(outputDir, { recursive: true });

      if (opts.dir) {
        const resolvedDir = path.resolve(opts.dir);
        if (!fs.existsSync(resolvedDir)) {
          console.error(`\n  Error: Directory not found: ${resolvedDir}\n`);
          process.exit(1);
        }
        const sp = startSpinner('Scanning local directory...');
        try {
          profile = await runDirMode(resolvedDir, opts.name);
          succeedSpinner(sp, 'Directory scan', `${profile.colors.length} colors · ${profile.components.length} components`);
        } catch (e: any) {
          failSpinner(sp, 'Directory scan', e.message);
          throw e;
        }
      } else if (opts.repo) {
        const sp = startSpinner('Cloning repository...');
        try {
          profile = await runRepoMode(opts.repo, opts.name);
          succeedSpinner(sp, 'Repo clone + scan', `${profile.colors.length} colors · ${profile.components.length} components`);
        } catch (e: any) {
          failSpinner(sp, 'Repo clone', e.message);
          throw e;
        }
      } else {
        const safeName = (opts.name || new URL(opts.url!).hostname.replace(/^www\./, '').split('.')[0])
          .replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const skillDir = path.join(outputDir, `${safeName}-design`);
        fs.mkdirSync(path.join(skillDir, 'screenshots'), { recursive: true });

        const sp1 = startSpinner('Fetching HTML + CSS...');
        let urlResult: Awaited<ReturnType<typeof runUrlMode>>;
        try {
          urlResult = await runUrlMode(opts.url!, opts.name, skillDir);
          const { cssColorCount, cssFontCount, computedColorCount, hadPlaywright } = urlResult;
          const detail = hadPlaywright
            ? `${cssColorCount} CSS colors · ${computedColorCount} computed · ${cssFontCount} fonts`
            : `${cssColorCount} colors · ${cssFontCount} fonts (Playwright not found)`;
          succeedSpinner(sp1, 'CSS + token extraction', detail);
          if (!hadPlaywright) {
            warnLine('Playwright not installed — computed style extraction skipped');
            warnLine('Fix: npm install -g playwright && npx playwright install chromium');
          }
        } catch (e: any) {
          failSpinner(sp1, 'CSS + token extraction', e.message);
          throw e;
        }
        profile = urlResult.profile;
        screenshotPath = urlResult.screenshotPath;
      }

      const isUltra = opts.mode === 'ultra' && !!opts.url;
      let ultraAnimations: import('./types-ultra.js').FullAnimationResult | null = null;

      if (isUltra) {
        const ultraScreens = Math.max(1, Math.min(20, parseInt(opts.screens, 10) || 5));
        const safeName = (opts.name || new URL(opts.url!).hostname.replace(/^www\./, '').split('.')[0])
          .replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const skillDir = path.join(path.resolve(opts.out), `${safeName}-design`);

        const { loadPlaywright } = await import('./playwright-loader.js');
        if (!loadPlaywright()) {
          showUltraPlaywrightError();
          warnLine('Continuing without ultra features...');
        } else {
          const spAnim = startSpinner('Capturing scroll journey + animations...');
          try {
            const ultraResult = await runUltraMode(opts.url!, profile, skillDir, {
              screens: ultraScreens,
              viewports: responsiveViewports,
            });
            ultraAnimations = ultraResult.animations;
            const kf = ultraAnimations.keyframes.length;
            const sf = ultraAnimations.scrollFrames.length;
            const libs = ultraAnimations.libraries.map(l => l.name).join(', ') || 'none';
            succeedSpinner(spAnim, 'Ultra extraction', `${sf} scroll frames · ${kf} keyframes · ${libs}`);
          } catch (e: any) {
            failSpinner(spAnim, 'Ultra extraction', e.message);
            throw e;
          }
        }
      }

      const shouldWriteDesignMd = opts.format === 'design-md' || opts.format === 'both';
      const shouldWriteSkill = opts.skill !== false && (opts.format === 'skill' || opts.format === 'both');

      const designMdContent = generateDesignMd(profile, screenshotPath);
      const safeName = profile.projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const designDir = path.join(path.resolve(opts.out), `${safeName}-design`);
      fs.mkdirSync(designDir, { recursive: true });

      let designMdPath: string | undefined;
      if (shouldWriteDesignMd) {
        const spWrite = startSpinner('Writing DESIGN.md...');
        designMdPath = path.join(designDir, 'DESIGN.md');
        fs.writeFileSync(designMdPath, designMdContent, 'utf-8');
        succeedSpinner(spWrite, 'DESIGN.md', designMdPath);
      }

      let skillFilePath: string | undefined;
      let skillInstalled = false;
      if (shouldWriteSkill) {
        const spSkill = startSpinner('Bundling .skill package...');
        try {
          const generated = await generateSkill(profile, designMdContent, path.resolve(opts.out), screenshotPath, ultraAnimations);
          let contextDetail = '';

          if (skillContext === 'compact') {
            const metrics = compactGeneratedSkill(profile, generated.skillDir);
            contextDetail = ` · compact ${metrics.lines} lines · ${metrics.characters} chars`;
          } else {
            embedResponsiveEvidenceInSkill(generated.skillDir);
          }

          const result = await finalizeGeneratedSkill(profile, generated);
          skillFilePath = result.skillFile;
          succeedSpinner(spSkill, '.skill package', `${skillFilePath}${contextDetail}`);

          const integration = installAgentIntegrations(opts.agent, {
            skillDir: result.skillDir,
            skillFolderName: path.basename(result.skillDir),
            projectName: profile.projectName,
          });
          skillInstalled = integration.installed;

          if (!integration.installed) {
            warnLine(`Could not install all requested ${opts.agent} integration files automatically`);
          }
        } catch (e: any) {
          failSpinner(spSkill, '.skill package', e.message);
          throw e;
        }
      }

      showAgentResults({
        profile,
        animations: ultraAnimations ?? undefined,
        skillFilePath,
        designMdPath,
        projectName: safeName,
        skillInstalled,
        agent: opts.agent,
      });
    } catch (err: any) {
      console.error(`\n  Error: ${err.message || err}\n`);
      process.exit(1);
    }
  });

program.parse();
