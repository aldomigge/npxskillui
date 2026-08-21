import * as fs from 'fs';
import * as path from 'path';
import type {
  PageScreenshot,
  ResponsiveChange,
  ResponsiveElementSnapshot,
  ResponsiveEvidenceResult,
  ResponsivePageEvidence,
  ResponsiveViewport,
  ResponsiveViewportObservation,
} from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';
import { stabilizePageForDiscovery } from './discovery';

const MIN_WIDTH = 240;
const MAX_WIDTH = 3840;
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 2160;
const MAX_VIEWPORTS = 3;

export interface ResponsiveSurfacePlan {
  pageUrl: string;
  pageSlug: string;
  pageTitle: string;
  viewport: ResponsiveViewport;
}

/**
 * Parse comma-separated viewport samples such as:
 *   390x844,768x1024,1440x900
 *
 * Responsive evidence is opt-in. The parser keeps at most three unique
 * viewports so runtime cost stays bounded even when the page crawl is broad.
 */
export function parseResponsiveViewports(spec?: string): ResponsiveViewport[] {
  if (!spec?.trim()) return [];

  const viewports: ResponsiveViewport[] = [];
  const seen = new Set<string>();

  for (const token of spec.split(',')) {
    const normalized = token.trim().toLowerCase().replace('×', 'x');
    if (!normalized) continue;

    const match = normalized.match(/^(\d{2,4})x(\d{2,4})$/);
    if (!match) {
      throw new Error(`Invalid viewport "${token.trim()}". Use WIDTHxHEIGHT, for example 390x844.`);
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < MIN_WIDTH || width > MAX_WIDTH || height < MIN_HEIGHT || height > MAX_HEIGHT) {
      throw new Error(
        `Viewport ${width}x${height} is outside the supported range ` +
        `${MIN_WIDTH}-${MAX_WIDTH}px wide and ${MIN_HEIGHT}-${MAX_HEIGHT}px high.`
      );
    }

    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    viewports.push({ width, height, key });
  }

  if (viewports.length > MAX_VIEWPORTS) {
    throw new Error(`Too many responsive viewports. Use at most ${MAX_VIEWPORTS} samples per extraction.`);
  }

  return viewports;
}

/**
 * Build deterministic page × viewport work. Smaller samples run first so the
 * largest supplied viewport is applied last, leaving an attached CDP browser
 * in a desktop-like state when desktop is part of the requested samples.
 */
export function buildResponsiveSurfacePlan(
  pages: PageScreenshot[],
  viewports: ResponsiveViewport[]
): ResponsiveSurfacePlan[] {
  const orderedViewports = [...viewports].sort((a, b) => {
    if (a.width !== b.width) return a.width - b.width;
    return a.height - b.height;
  });

  return pages.flatMap(page => orderedViewports.map(viewport => ({
    pageUrl: page.url,
    pageSlug: page.slug,
    pageTitle: page.title,
    viewport,
  })));
}

/**
 * Compare two samples using conservative structural properties only.
 *
 * Presence-only differences are intentionally ignored. On a live page, a node
 * that exists in only one sample may be caused by lazy loading, carousel state,
 * A/B content, or timing rather than a media-query/layout decision. The
 * screenshots remain the authoritative evidence for those cases.
 *
 * Width/height changes are also ignored. Grid templates are reported only when
 * their track count changes, so a fluid one-column 1434px → 384px resize is not
 * mislabeled as a structural responsive switch.
 */
export function diffResponsiveElements(
  baseline: ResponsiveElementSnapshot[],
  target: ResponsiveElementSnapshot[]
): ResponsiveChange[] {
  const baselineMap = new Map(baseline.map(element => [element.key, element]));
  const targetMap = new Map(target.map(element => [element.key, element]));
  const keys = new Set([...baselineMap.keys(), ...targetMap.keys()]);
  const changes: ResponsiveChange[] = [];

  for (const key of keys) {
    const before = baselineMap.get(key);
    const after = targetMap.get(key);

    // A single runtime sample cannot prove that DOM presence/absence is caused
    // by responsive CSS. Require the same structural identity in both samples.
    if (!before || !after) continue;

    const selector = after.selector || before.selector || key;

    if (before.visible !== after.visible) {
      changes.push({
        selector,
        property: 'visibility',
        from: visibilityLabel(before),
        to: visibilityLabel(after),
      });
    }

    // Do not report secondary layout properties for elements hidden in either
    // sample; visibility is the stronger and less noisy observation.
    if (!before.visible || !after.visible) continue;

    pushChange(changes, selector, 'display', before.display, after.display);

    if (isFlexDisplay(before.display) || isFlexDisplay(after.display)) {
      pushChange(changes, selector, 'flex-direction', before.flexDirection, after.flexDirection);
    }

    if (
      (isGridDisplay(before.display) || isGridDisplay(after.display)) &&
      shouldReportGridTemplateChange(before.gridTemplateColumns, after.gridTemplateColumns)
    ) {
      pushChange(
        changes,
        selector,
        'grid-template-columns',
        before.gridTemplateColumns,
        after.gridTemplateColumns
      );
    }

    pushChange(changes, selector, 'position', before.position, after.position);
  }

  return dedupeChanges(changes);
}

export async function captureResponsiveEvidence(
  pages: PageScreenshot[],
  viewports: ResponsiveViewport[],
  skillDir: string
): Promise<ResponsiveEvidenceResult> {
  if (pages.length === 0 || viewports.length === 0) {
    return { viewports: [...viewports], pages: [] };
  }

  const playwright = loadPlaywright();
  if (!playwright) return { viewports: [...viewports], pages: [] };

  const responsiveDir = path.join(skillDir, 'screens', 'responsive');
  fs.mkdirSync(responsiveDir, { recursive: true });

  const observations: ResponsiveViewportObservation[] = [];
  const plan = buildResponsiveSurfacePlan(pages, viewports);
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    for (const surface of plan) {
      let page: any | undefined;
      try {
        page = await context.newPage();

        // Important for CDP: newContext({ viewport }) is ignored when the
        // existing Chrome context is reused, so viewport emulation must be
        // explicit on the page itself.
        await page.setViewportSize({
          width: surface.viewport.width,
          height: surface.viewport.height,
        });

        await page.goto(surface.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1200);
        const discovery = await stabilizePageForDiscovery(page);

        const snapshot = await captureResponsiveSnapshot(page);
        const screenshotName = `${surface.pageSlug}--${surface.viewport.key}.png`;
        const screenshotAbsolute = path.join(responsiveDir, screenshotName);
        await page.screenshot({ path: screenshotAbsolute, fullPage: true });

        observations.push({
          pageUrl: surface.pageUrl,
          pageSlug: surface.pageSlug,
          pageTitle: surface.pageTitle,
          viewport: surface.viewport,
          screenshotPath: `screens/responsive/${screenshotName}`,
          domElementCount: snapshot.domElementCount,
          documentWidth: snapshot.documentWidth,
          documentHeight: snapshot.documentHeight,
          horizontalOverflow: snapshot.horizontalOverflow,
          discovery,
          elements: snapshot.elements,
        });
      } catch {
        // One viewport/page failure should not abort the whole Ultra run.
      } finally {
        try {
          if (page && !page.isClosed?.()) await page.close();
        } catch {}
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return buildResponsiveEvidenceResult(observations, viewports);
}

export function buildResponsiveEvidenceResult(
  observations: ResponsiveViewportObservation[],
  viewports: ResponsiveViewport[]
): ResponsiveEvidenceResult {
  const pagesBySlug = new Map<string, ResponsiveViewportObservation[]>();
  for (const observation of observations) {
    const list = pagesBySlug.get(observation.pageSlug) || [];
    list.push(observation);
    pagesBySlug.set(observation.pageSlug, list);
  }

  const pages: ResponsivePageEvidence[] = [];
  for (const pageObservations of pagesBySlug.values()) {
    const ordered = [...pageObservations].sort((a, b) => {
      if (a.viewport.width !== b.viewport.width) return a.viewport.width - b.viewport.width;
      return a.viewport.height - b.viewport.height;
    });
    const baseline = ordered[ordered.length - 1];
    if (!baseline) continue;

    pages.push({
      pageUrl: baseline.pageUrl,
      pageSlug: baseline.pageSlug,
      pageTitle: baseline.pageTitle,
      observations: ordered,
      comparisons: ordered
        .filter(observation => observation !== baseline)
        .map(observation => ({
          baseline: baseline.viewport,
          target: observation.viewport,
          changes: diffResponsiveElements(baseline.elements, observation.elements),
        })),
    });
  }

  return {
    viewports: [...viewports].sort((a, b) => a.width - b.width || a.height - b.height),
    pages,
  };
}

async function captureResponsiveSnapshot(page: any): Promise<{
  domElementCount: number;
  documentWidth: number;
  documentHeight: number;
  horizontalOverflow: boolean;
  elements: ResponsiveElementSnapshot[];
}> {
  return page.evaluate(() => {
    const SELECTORS = [
      'header',
      'nav',
      'main',
      'footer',
      'section',
      'article',
      '[class*="header"]',
      '[class*="nav"]',
      '[class*="menu"]',
      '[class*="sidebar"]',
      '[class*="drawer"]',
      '[class*="grid"]',
      '[class*="flex"]',
      '[class*="card"]',
      '[class*="button"]',
      '[class*="btn"]',
    ];

    const stableClass = (className: string) => {
      if (!className || className.length < 3 || className.length > 80) return false;
      if (/^(js-|is-|has-|data-|aria-)/.test(className)) return false;
      return /^[a-zA-Z]/.test(className);
    };

    const segment = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      if (element.id) return `${tag}#${element.id}`;
      const classes = Array.from(element.classList).filter(stableClass).slice(0, 2);
      const classPart = classes.map(className => `.${className}`).join('');
      const parent = element.parentElement;
      if (!parent) return `${tag}${classPart}`;
      const sameTagSiblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);
      const nth = sameTagSiblings.length > 1 ? `:nth-of-type(${sameTagSiblings.indexOf(element) + 1})` : '';
      return `${tag}${classPart}${nth}`;
    };

    const elementKey = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      let depth = 0;
      while (node && depth < 4) {
        parts.unshift(segment(node));
        if (node.id) break;
        node = node.parentElement;
        depth++;
      }
      return parts.join(' > ');
    };

    const candidates: Element[] = [];
    const seen = new WeakSet<Element>();
    for (const selector of SELECTORS) {
      document.querySelectorAll(selector).forEach(element => {
        if (seen.has(element)) return;
        seen.add(element);
        candidates.push(element);
      });
    }

    const elements = candidates.slice(0, 120).map(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
      const key = elementKey(element);

      return {
        key,
        selector: key,
        tag: element.tagName.toLowerCase(),
        visible,
        display: style.display || '',
        flexDirection: style.flexDirection || '',
        gridTemplateColumns: style.gridTemplateColumns || '',
        position: style.position || '',
      };
    });

    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      document.documentElement.offsetWidth,
      document.body?.offsetWidth || 0
    );
    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      document.documentElement.offsetHeight,
      document.body?.offsetHeight || 0
    );
    const viewportWidth = Math.max(window.innerWidth || 0, 1);

    return {
      domElementCount: document.querySelectorAll('*').length,
      documentWidth,
      documentHeight,
      horizontalOverflow: documentWidth > viewportWidth + 2,
      elements,
    };
  });
}

function visibilityLabel(element: ResponsiveElementSnapshot): string {
  return element.visible ? 'visible' : 'hidden';
}

function isFlexDisplay(display: string): boolean {
  return display === 'flex' || display === 'inline-flex';
}

function isGridDisplay(display: string): boolean {
  return display === 'grid' || display === 'inline-grid';
}

/**
 * Report grid-template changes only when the number of rendered tracks changes.
 * Computed pixel widths naturally resize with the viewport and are not a mode
 * switch by themselves.
 */
export function shouldReportGridTemplateChange(from: string, to: string): boolean {
  if (!from || !to || from === to) return false;

  const fromCount = gridTrackCount(from);
  const toCount = gridTrackCount(to);
  if (fromCount !== null && toCount !== null) return fromCount !== toCount;

  return false;
}

function gridTrackCount(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || normalized === 'none') return 0;

  const tokens = splitTopLevelGridTracks(normalized);
  if (tokens.length === 0) return null;

  let count = 0;
  for (const token of tokens) {
    const repeat = token.match(/^repeat\(\s*(\d+)\s*,/i);
    if (repeat) {
      count += Number(repeat[1]);
      continue;
    }

    // auto-fit/auto-fill cannot be converted to an exact track count from the
    // template string alone, so avoid claiming a structural change.
    if (/^repeat\(\s*(auto-fit|auto-fill)\s*,/i.test(token)) return null;
    count++;
  }

  return count;
}

function splitTopLevelGridTracks(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function pushChange(
  changes: ResponsiveChange[],
  selector: string,
  property: ResponsiveChange['property'],
  from: string,
  to: string
): void {
  if (!from || !to || from === to) return;
  changes.push({ selector, property, from, to });
}

function dedupeChanges(changes: ResponsiveChange[]): ResponsiveChange[] {
  const seen = new Set<string>();
  return changes.filter(change => {
    const key = `${change.selector}|${change.property}|${change.from}|${change.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
