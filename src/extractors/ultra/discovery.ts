import type { ComponentStateEvidence } from '../../types';
import type { DOMComponent, PageDiscoveryStats } from '../../types-ultra';

export interface DOMComponentPageObservation {
  url: string;
  components: DOMComponent[];
}

export interface DiscoveryMeasure {
  elementCount: number;
  documentHeight: number;
}

export interface PageStabilizationOptions {
  maxPasses?: number;
  maxStepsPerPass?: number;
  settleMs?: number;
  finalSettleMs?: number;
}

/**
 * Scroll a page in a bounded number of steps so IntersectionObserver/lazy-load
 * content has a chance to enter the rendered DOM. The page is returned to the
 * top before callers capture measured styles or screenshots.
 *
 * This is intentionally bounded: it is discovery stabilization, not an
 * infinite-scroll crawler.
 */
export async function stabilizePageForDiscovery(
  page: any,
  options: PageStabilizationOptions = {}
): Promise<PageDiscoveryStats> {
  const maxPasses = clampInteger(options.maxPasses ?? 2, 1, 3);
  const maxStepsPerPass = clampInteger(options.maxStepsPerPass ?? 8, 2, 12);
  const settleMs = clampInteger(options.settleMs ?? 180, 50, 1000);
  const finalSettleMs = clampInteger(options.finalSettleMs ?? 350, 100, 1500);

  const before = await measurePage(page);
  let previous = before;
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const viewportHeight = await page.evaluate(() => Math.max(window.innerHeight || 0, 1));
    const positions = buildScrollPositions(previous.documentHeight, viewportHeight, maxStepsPerPass);

    for (const y of positions) {
      await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(settleMs);
    }

    passes++;
    const current = await measurePage(page);
    const grew = hasDiscoveryGrowth(previous, current);
    previous = current;
    if (!grew) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(finalSettleMs);
  const after = await measurePage(page);

  return {
    beforeElementCount: before.elementCount,
    afterElementCount: after.elementCount,
    beforeHeight: before.documentHeight,
    afterHeight: after.documentHeight,
    scrollPasses: passes,
    grew: hasDiscoveryGrowth(before, after),
  };
}

/** Build evenly distributed scroll positions, always including top and bottom. */
export function buildScrollPositions(
  documentHeight: number,
  viewportHeight: number,
  maxSteps: number
): number[] {
  const height = Math.max(0, Math.round(documentHeight));
  const viewport = Math.max(1, Math.round(viewportHeight));
  const bottom = Math.max(0, height - viewport);
  if (bottom === 0) return [0];

  const stepCount = Math.max(2, Math.min(maxSteps, Math.ceil(height / Math.max(viewport * 0.75, 1)) + 1));
  const positions = new Set<number>();
  for (let i = 0; i < stepCount; i++) {
    positions.add(Math.round((bottom * i) / (stepCount - 1)));
  }
  positions.add(bottom);
  return [...positions].sort((a, b) => a - b);
}

export function hasDiscoveryGrowth(before: DiscoveryMeasure, after: DiscoveryMeasure): boolean {
  return after.elementCount > before.elementCount || after.documentHeight > before.documentHeight + 2;
}

/**
 * Use successfully captured crawl pages as the runtime corpus, with the origin
 * guaranteed to be first. Query/hash-only variations are deduplicated.
 */
export function buildRuntimeDiscoveryUrls(
  originUrl: string,
  crawledUrls: string[],
  maxPages: number
): string[] {
  const limit = Math.max(1, maxPages || 1);
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [originUrl, ...crawledUrls]) {
    const key = normalizeDiscoveryUrl(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    urls.push(candidate);
    if (urls.length >= limit) break;
  }

  return urls;
}

/** Normalize page identity without conflating different pathnames. */
export function normalizeDiscoveryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}`;
  } catch {
    return url.split('#')[0].split('?')[0].replace(/\/+$/, '');
  }
}

/**
 * Aggregate raw DOM observations for COMPONENTS.md without flattening visual
 * variants. The canonical profile is still merged per page so ComponentEvidence
 * retains exact pageUrl provenance.
 */
export function mergeDOMComponentObservations(
  observations: DOMComponentPageObservation[]
): DOMComponent[] {
  const groups = new Map<string, DOMComponent>();

  for (const observation of observations) {
    const pageUrl = normalizeDiscoveryUrl(observation.url) || observation.url;

    for (const component of observation.components) {
      const key = `${component.pattern}|${component.styleFingerprint || ''}`;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          ...component,
          commonClasses: [...component.commonClasses],
          reasons: component.reasons ? [...component.reasons] : undefined,
          stateEvidence: component.stateEvidence ? [...component.stateEvidence] : undefined,
          pages: [pageUrl],
          totalInstances: component.instances,
        });
        continue;
      }

      const pages = new Set(existing.pages || []);
      pages.add(pageUrl);
      existing.pages = [...pages];
      existing.instances = Math.max(existing.instances, component.instances);
      existing.totalInstances = (existing.totalInstances ?? existing.instances) + component.instances;
      existing.confidence = Math.max(existing.confidence || 0, component.confidence || 0);
      existing.commonClasses = unique([...existing.commonClasses, ...component.commonClasses]);
      existing.reasons = unique([...(existing.reasons || []), ...(component.reasons || [])]);
      existing.stateEvidence = mergeStates(existing.stateEvidence, component.stateEvidence);
    }
  }

  return [...groups.values()].sort((a, b) => {
    const confidenceDiff = (b.confidence || 0) - (a.confidence || 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    const pageDiff = (b.pages?.length || 0) - (a.pages?.length || 0);
    if (pageDiff !== 0) return pageDiff;
    return b.instances - a.instances;
  });
}

async function measurePage(page: any): Promise<DiscoveryMeasure> {
  return page.evaluate(() => ({
    elementCount: document.querySelectorAll('*').length,
    documentHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      document.documentElement.offsetHeight,
      document.body?.offsetHeight || 0
    ),
  }));
}

function mergeStates(
  left?: ComponentStateEvidence[],
  right?: ComponentStateEvidence[]
): ComponentStateEvidence[] | undefined {
  const states = [...(left || []), ...(right || [])];
  if (states.length === 0) return undefined;

  const seen = new Set<string>();
  return states.filter(state => {
    const changes = state.changes
      .map(change => `${change.property}:${change.from}->${change.to}`)
      .sort()
      .join('|');
    const key = `${state.state}|${state.selector || ''}|${changes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
