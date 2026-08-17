import * as fs from 'fs';
import * as path from 'path';
import { DesignProfile } from '../types';
import {
  UltraOptions,
  UltraResult,
  FullAnimationResult,
  RuntimeDiscoveryPage,
  ResponsiveEvidenceResult,
} from '../types-ultra';
import { capturePageScreenshots } from '../extractors/ultra/pages';
import { captureInteractions } from '../extractors/ultra/interactions';
import { extractLayouts } from '../extractors/ultra/layout';
import { detectDOMComponentsWithDiscovery } from '../extractors/ultra/components-dom';
import { attachInteractionsToDOMComponents } from '../extractors/ultra/component-interactions';
import { captureAnimations } from '../extractors/ultra/animations';
import { captureResponsiveEvidence } from '../extractors/ultra/responsive';
import {
  buildRuntimeDiscoveryUrls,
  mergeDOMComponentObservations,
  normalizeDiscoveryUrl,
} from '../extractors/ultra/discovery';
import { mergeRuntimeComponentsIntoProfile } from '../extractors/component-evidence';
import { generateLayoutMd } from '../writers/layout-md';
import { generateInteractionsMd } from '../writers/interactions-md';
import { generateComponentsMd } from '../writers/components-md';
import { generateAnimationsMd } from '../writers/animations-md';
import { generateResponsiveMd } from '../writers/responsive-md';
import { writeTokensJson } from '../writers/tokens-json';
import { loadPlaywright } from '../playwright-loader';

/**
 * Ultra mode orchestrator.
 *
 * Runs AFTER the normal url mode pipeline. Adds:
 * - screens/pages/      — full-page screenshots per crawled page
 * - screens/sections/   — clipped section screenshots per page
 * - screens/states/     — hover/focus state screenshots on the origin page
 * - screens/scroll/     — 7 scroll-journey screenshots + video first frames
 * - screens/responsive/ — opt-in sampled viewport screenshots
 * - references/LAYOUT.md
 * - references/INTERACTIONS.md
 * - references/COMPONENTS.md
 * - references/ANIMATIONS.md
 * - references/RESPONSIVE.md (when --viewports is supplied)
 * - tokens/colors.json
 * - tokens/spacing.json
 * - tokens/typography.json
 *
 * Runtime component discovery reuses the successfully crawled screenshot pages
 * instead of inventing a second route crawler. Each page is scroll/lazy-load
 * stabilized before detection. Canonical merging remains page-aware through
 * ComponentEvidence.pageUrl; raw documentation aggregates only exact
 * structure+style observations across pages.
 *
 * Responsive evidence is deliberately separate from canonical component
 * promotion in this stage. It samples the same crawled pages at explicit
 * viewport sizes and records measured structural changes without pretending
 * those samples identify exact CSS breakpoint thresholds.
 */
export async function runUltraMode(
  url: string,
  profile: DesignProfile,
  skillDir: string,
  opts: UltraOptions
): Promise<UltraResult> {
  fs.mkdirSync(path.join(skillDir, 'screens', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'sections'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'states'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'scroll'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'tokens'), { recursive: true });

  const hasPlaywright = loadPlaywright() !== null;

  if (!hasPlaywright) {
    process.stdout.write('\n  ⚠  Playwright not found — ultra visual features skipped\n');
    process.stdout.write('     Fix: npm install -g playwright && npx playwright install chromium\n\n');
    writeTokensJson(profile, skillDir);
    writeStubs(skillDir);
    const emptyAnim = emptyAnimResult();
    return {
      pageScreenshots: [],
      sectionScreenshots: [],
      interactions: [],
      layouts: [],
      domComponents: [],
      runtimeDiscovery: [],
      animations: emptyAnim,
    };
  }

  // ── Step 1: Animation extraction (origin scroll journey) ───────────────
  const animations = await captureAnimations(url, skillDir);

  // ── Step 2: Multi-page crawl + stabilized screenshots/sections ─────────
  const { pages, sections } = await capturePageScreenshots(url, skillDir, opts.screens);

  // ── Step 3: Optional responsive runtime evidence ───────────────────────
  const responsive: ResponsiveEvidenceResult = opts.viewports?.length
    ? await captureResponsiveEvidence(pages, opts.viewports, skillDir)
    : { viewports: [], pages: [] };

  // ── Step 4: Origin micro-interactions ──────────────────────────────────
  const interactions = await captureInteractions(url, skillDir);

  // ── Step 5: Origin layout extraction ───────────────────────────────────
  const layouts = await extractLayouts(url);

  // ── Step 6: Multi-page DOM components + measured runtime evidence ──────
  const runtimeUrls = buildRuntimeDiscoveryUrls(
    url,
    pages.map(page => page.url),
    opts.screens
  );
  const pageObservations: Array<{ url: string; components: import('../types-ultra').DOMComponent[] }> = [];
  const runtimeDiscovery: RuntimeDiscoveryPage[] = [];
  const originKey = normalizeDiscoveryUrl(url);

  for (const pageUrl of runtimeUrls) {
    const detection = await detectDOMComponentsWithDiscovery(pageUrl);
    const isOriginPage = normalizeDiscoveryUrl(pageUrl) === originKey;
    const pageComponents = isOriginPage
      ? attachInteractionsToDOMComponents(detection.components, interactions)
      : detection.components;

    pageObservations.push({ url: pageUrl, components: pageComponents });
    runtimeDiscovery.push({
      url: normalizeDiscoveryUrl(pageUrl) || pageUrl,
      componentCount: pageComponents.length,
      discovery: detection.discovery,
    });

    // Merge per page rather than from the raw aggregate so pageUrl provenance
    // and PR #6 measured-variant isolation remain exact.
    mergeRuntimeComponentsIntoProfile(profile, pageComponents, pageUrl);
  }

  const domComponents = mergeDOMComponentObservations(pageObservations);

  // ── Step 7: Write all reference files ─────────────────────────────────
  const refsDir = path.join(skillDir, 'references');

  const animMd = generateAnimationsMd(animations, profile);
  fs.writeFileSync(path.join(refsDir, 'ANIMATIONS.md'), animMd, 'utf-8');

  const layoutMd = generateLayoutMd(layouts, profile);
  fs.writeFileSync(path.join(refsDir, 'LAYOUT.md'), layoutMd, 'utf-8');

  const interactionsMd = generateInteractionsMd(interactions, profile);
  fs.writeFileSync(path.join(refsDir, 'INTERACTIONS.md'), interactionsMd, 'utf-8');

  const componentsMd = generateComponentsMd(domComponents, profile, runtimeDiscovery);
  fs.writeFileSync(path.join(refsDir, 'COMPONENTS.md'), componentsMd, 'utf-8');

  if (opts.viewports?.length) {
    const responsiveMd = generateResponsiveMd(responsive, profile);
    fs.writeFileSync(path.join(refsDir, 'RESPONSIVE.md'), responsiveMd, 'utf-8');
  }

  writeTokensJson(profile, skillDir);

  const visualGuideMd = generateVisualGuideMd(profile, pages, sections, animations);
  fs.writeFileSync(path.join(refsDir, 'VISUAL_GUIDE.md'), visualGuideMd, 'utf-8');

  writeScreensIndex(pages, sections, animations, responsive, skillDir);

  console.log(' ✓');
  printUltraSummary(animations, runtimeDiscovery, domComponents.length, responsive);

  return {
    pageScreenshots: pages,
    sectionScreenshots: sections,
    interactions,
    layouts,
    domComponents,
    runtimeDiscovery,
    animations,
  };
}

// ── Visual Guide Generator ────────────────────────────────────────────

function generateVisualGuideMd(
  profile: DesignProfile,
  pages: import('../types-ultra').PageScreenshot[],
  sections: import('../types-ultra').SectionScreenshot[],
  anim: FullAnimationResult
): string {
  let md = `# ${profile.projectName} — Visual Guide\n\n`;
  md += `> Master visual reference. Study every screenshot carefully before implementing any UI.\n`;
  md += `> Match colors, layout, typography, spacing, and motion states exactly.\n\n`;

  if (anim.libraries.length > 0) {
    const libs = anim.libraries.map(l => `**${l.name}**`).join(', ');
    md += `**Motion Stack:** ${libs}\n\n`;
  }
  if (anim.webglDetected) {
    md += `**WebGL/3D:** Detected (${anim.canvasCount} canvas elements) — replicate with Three.js or CSS 3D transforms\n\n`;
  }

  if (anim.scrollFrames.length > 0) {
    md += `## Scroll Journey\n\n`;
    md += `The page has cinematic scroll animations. Each screenshot below shows the exact visual state at that scroll depth.\n`;
    md += `**Replicate these transitions precisely** — the design changes dramatically as you scroll.\n\n`;

    for (const frame of anim.scrollFrames) {
      const relPath = `../screens/scroll/${path.basename(frame.filePath)}`;
      const label = frame.scrollPercent === 0 ? 'Hero — Above the fold'
        : frame.scrollPercent === 100 ? 'Footer — End of page'
        : `${frame.scrollPercent}% scroll depth`;
      md += `### ${label}\n\n`;
      md += `*Scroll position: ${frame.scrollY}px of ${frame.pageHeight}px total*\n\n`;
      md += `![${label}](${relPath})\n\n`;
    }
  }

  if (anim.videos.some(v => v.firstFramePath)) {
    md += `## Video Backgrounds\n\n`;
    md += `These videos play as background elements. Use first-frame as poster image while video loads.\n\n`;
    for (const v of anim.videos.filter(vv => vv.firstFramePath)) {
      const relPath = `../screens/scroll/${path.basename(v.firstFramePath!)}`;
      md += `### Video ${v.index} (${v.role})\n\n`;
      if (v.src) md += `*Source: \`${v.src.slice(0, 80)}...\`*\n\n`;
      md += `![Video ${v.index} first frame](${relPath})\n\n`;
    }
  }

  if (pages.length > 0) {
    md += `## Full Page Screenshots\n\n`;
    for (const p of pages) {
      const relPath = `../screens/pages/${path.basename(p.filePath)}`;
      md += `### ${p.title}\n\n`;
      md += `*URL: \`${p.url}\`*\n\n`;
      if (p.discovery?.grew) {
        const added = p.discovery.afterElementCount - p.discovery.beforeElementCount;
        md += `*Lazy discovery: +${Math.max(0, added)} DOM elements after ${p.discovery.scrollPasses} bounded scroll pass(es).*\n\n`;
      }
      md += `![${p.title}](${relPath})\n\n`;
    }
  }

  if (sections.length > 0) {
    md += `## Section Screenshots\n\n`;
    md += `Clipped sections showing individual components in context.\n\n`;
    for (const s of sections) {
      const relPath = `../screens/sections/${path.basename(s.filePath)}`;
      md += `### Section ${s.index} — \`${s.selector}\`\n\n`;
      md += `*${s.width}×${s.height}px*\n\n`;
      md += `![Section ${s.index}](${relPath})\n\n`;
    }
  }

  return md;
}

// ── Helpers ────────────────────────────────────────────────────────────

function printUltraSummary(
  anim: FullAnimationResult,
  discoveryPages: RuntimeDiscoveryPage[],
  rawComponentCount: number,
  responsive: ResponsiveEvidenceResult
): void {
  const libs = anim.libraries.map(l => l.name).join(', ') || 'none';
  console.log('');
  console.log(`  Animation Stack: ${libs}`);
  if (anim.webglDetected) console.log(`  WebGL/3D: detected (${anim.canvasCount} canvas elements)`);
  if (anim.videos.length > 0) {
    const bg = anim.videos.filter(v => v.role === 'background').length;
    console.log(`  Video: ${anim.videos.length} elements (${bg} background)`);
  }
  if (anim.lottieCount > 0) console.log(`  Lottie: ${anim.lottieCount} players`);
  if (anim.keyframes.length > 0) console.log(`  Keyframes: ${anim.keyframes.length} extracted`);
  if (anim.scrollPatterns.length > 0) console.log(`  Scroll patterns: ${anim.scrollPatterns.length} types`);
  if (discoveryPages.length > 0) {
    const grew = discoveryPages.filter(page => page.discovery.grew).length;
    console.log(`  Runtime discovery: ${discoveryPages.length} page(s), ${rawComponentCount} raw pattern(s), ${grew} page(s) grew after scroll`);
  }
  if (responsive.pages.length > 0) {
    const samples = responsive.pages.reduce((total, page) => total + page.observations.length, 0);
    const overflows = responsive.pages.flatMap(page => page.observations).filter(sample => sample.horizontalOverflow).length;
    console.log(`  Responsive evidence: ${responsive.pages.length} page(s), ${responsive.viewports.length} viewport(s), ${samples} sample(s), ${overflows} overflow sample(s)`);
  }
}

function writeScreensIndex(
  pages: import('../types-ultra').PageScreenshot[],
  sections: import('../types-ultra').SectionScreenshot[],
  anim: FullAnimationResult,
  responsive: ResponsiveEvidenceResult,
  skillDir: string
): void {
  let md = `# Screenshot Index\n\n`;

  if (anim.scrollFrames.length > 0) {
    md += `## Scroll Journey\n\n`;
    md += `> Shows the cinematic state at each point of the page\n\n`;
    md += `| Scroll | Y Position | File |\n`;
    md += `|--------|-----------|------|\n`;
    for (const f of anim.scrollFrames) {
      md += `| ${f.scrollPercent}% | ${f.scrollY}px | \`${f.filePath}\` |\n`;
    }
    md += `\n`;
  }

  if (anim.videos.some(v => v.firstFramePath)) {
    md += `## Video First Frames\n\n`;
    for (const v of anim.videos) {
      if (v.firstFramePath) {
        md += `- Video ${v.index} (${v.role}): \`${v.firstFramePath}\`\n`;
      }
    }
    md += `\n`;
  }

  if (pages.length > 0) {
    md += `## Pages\n\n`;
    md += `| Page | URL | Discovery | File |\n`;
    md += `|------|-----|-----------|------|\n`;
    for (const p of pages) {
      const discovery = p.discovery
        ? `${p.discovery.scrollPasses} pass(es), ${p.discovery.beforeElementCount}→${p.discovery.afterElementCount} elements`
        : 'n/a';
      md += `| ${p.title} | \`${p.url}\` | ${discovery} | \`${p.filePath}\` |\n`;
    }
    md += `\n`;
  }

  if (responsive.pages.length > 0) {
    md += `## Responsive Samples\n\n`;
    md += `| Page | Viewport | Overflow | File |\n`;
    md += `|------|----------|----------|------|\n`;
    for (const page of responsive.pages) {
      for (const sample of page.observations) {
        md += `| ${page.pageTitle} | \`${sample.viewport.key}\` | ${sample.horizontalOverflow ? 'yes' : 'no'} | \`${sample.screenshotPath}\` |\n`;
      }
    }
    md += `\n`;
  }

  if (sections.length > 0) {
    md += `## Sections\n\n`;
    md += `| Page | Section | File |\n`;
    md += `|------|---------|------|\n`;
    for (const s of sections) {
      md += `| ${s.page} | #${s.index} (${s.selector}) | \`${s.filePath}\` |\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(path.join(skillDir, 'screens', 'INDEX.md'), md, 'utf-8');
}

function writeStubs(skillDir: string): void {
  const refsDir = path.join(skillDir, 'references');
  const note = '> Install Playwright to enable: `npm install playwright && npx playwright install chromium`\n\nRun `skillui --url <url> --mode ultra` after installing.\n';

  for (const file of ['ANIMATIONS.md', 'LAYOUT.md', 'INTERACTIONS.md', 'COMPONENTS.md']) {
    const filePath = path.join(refsDir, file);
    if (!fs.existsSync(filePath)) {
      const title = file.replace('.md', '').replace(/-/g, ' ');
      fs.writeFileSync(filePath, `# ${title} Reference\n\n${note}`, 'utf-8');
    }
  }
}

function emptyAnimResult(): FullAnimationResult {
  return {
    keyframes: [],
    scrollFrames: [],
    libraries: [],
    videos: [],
    scrollPatterns: [],
    animationVars: [],
    globalTransitions: [],
    canvasCount: 0,
    webglDetected: false,
    lottieCount: 0,
  };
}
