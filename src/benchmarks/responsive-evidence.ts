import type {
  PageScreenshot,
  ResponsiveElementSnapshot,
  ResponsiveViewportObservation,
} from '../types-ultra';
import {
  buildResponsiveEvidenceResult,
  buildResponsiveSurfacePlan,
  diffResponsiveElements,
  parseResponsiveViewports,
} from '../extractors/ultra/responsive';

function main(): void {
  const parsing = runParsingCases();
  const planning = runPlanningCases();
  const diffing = runDiffCases();
  const grouping = runGroupingCases();

  console.log('Responsive runtime evidence benchmark');
  console.log(`  viewport parsing cases: ${parsing.passed}/${parsing.total}`);
  console.log(`  surface planning cases: ${planning.passed}/${planning.total}`);
  console.log(`  structural diff cases: ${diffing.passed}/${diffing.total}`);
  console.log(`  evidence grouping cases: ${grouping.passed}/${grouping.total}`);
  console.log('  status:                 PASS');
}

function runParsingCases(): Result {
  let passed = 0;

  const parsed = parseResponsiveViewports('390x844, 768x1024, 1440x900');
  expectEqual(parsed.length, 3, 'three valid viewports should parse'); passed++;
  expectEqual(parsed[0].key, '390x844', 'viewport key should preserve exact dimensions'); passed++;

  const deduped = parseResponsiveViewports('390x844,390×844,1440x900');
  expectEqual(deduped.length, 2, 'duplicate viewports should collapse'); passed++;

  expectThrows(
    () => parseResponsiveViewports('phone'),
    'invalid viewport token should be rejected'
  ); passed++;

  expectThrows(
    () => parseResponsiveViewports('390x844,768x1024,1024x768,1440x900'),
    'more than three viewports should be rejected'
  ); passed++;

  return { passed, total: 5 };
}

function runPlanningCases(): Result {
  const pages: PageScreenshot[] = [
    { url: 'https://fixture.local/', slug: 'home', filePath: 'screens/pages/home.png', title: 'Home' },
    { url: 'https://fixture.local/news', slug: 'news', filePath: 'screens/pages/news.png', title: 'News' },
  ];
  const viewports = parseResponsiveViewports('1440x900,390x844,768x1024');
  const plan = buildResponsiveSurfacePlan(pages, viewports);

  let passed = 0;
  expectEqual(plan.length, 6, 'surface plan should be page × viewport'); passed++;
  expectEqual(plan[0].viewport.key, '390x844', 'smaller viewport should run first'); passed++;
  expectEqual(plan[2].viewport.key, '1440x900', 'largest viewport should run last per page'); passed++;
  expectEqual(plan[3].pageSlug, 'news', 'page order should remain stable'); passed++;
  return { passed, total: 4 };
}

function runDiffCases(): Result {
  const baseline: ResponsiveElementSnapshot[] = [
    element('nav.main', true, 'flex', 'row', 'none', 'static'),
    element('button.menu', false, 'none', 'row', 'none', 'static'),
    element('section.cards', true, 'grid', 'row', '1fr 1fr 1fr', 'relative'),
    element('div.content', true, 'flex', 'row', 'none', 'static'),
    element('aside.sidebar', true, 'block', 'row', 'none', 'sticky'),
  ];
  const mobile: ResponsiveElementSnapshot[] = [
    element('nav.main', false, 'none', 'row', 'none', 'static'),
    element('button.menu', true, 'block', 'row', 'none', 'fixed'),
    element('section.cards', true, 'grid', 'row', '1fr', 'relative'),
    element('div.content', true, 'flex', 'column', 'none', 'static'),
    element('aside.sidebar', true, 'block', 'row', 'none', 'static'),
  ];

  const changes = diffResponsiveElements(baseline, mobile);
  let passed = 0;

  expect(changes.some(change => change.selector === 'nav.main' && change.property === 'visibility'), 'nav visibility change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'button.menu' && change.property === 'visibility'), 'menu visibility change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'section.cards' && change.property === 'grid-template-columns'), 'grid mode change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'div.content' && change.property === 'flex-direction'), 'flex direction change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'aside.sidebar' && change.property === 'position'), 'position change should be detected'); passed++;
  expect(!changes.some(change => change.selector === 'nav.main' && change.property === 'display'), 'hidden element should not emit secondary display noise'); passed++;

  const missing = diffResponsiveElements(
    [element('div.desktop-only', true, 'block', 'row', 'none', 'static')],
    []
  );
  expectEqual(missing[0]?.to, 'absent', 'DOM disappearance should be explicit'); passed++;

  expectEqual(diffResponsiveElements(baseline, baseline).length, 0, 'identical samples should not invent changes'); passed++;
  return { passed, total: 8 };
}

function runGroupingCases(): Result {
  const viewports = parseResponsiveViewports('390x844,1440x900');
  const observations: ResponsiveViewportObservation[] = [
    observation('home', viewports[0], [element('nav.main', false, 'none', 'row', 'none', 'static')]),
    observation('home', viewports[1], [element('nav.main', true, 'flex', 'row', 'none', 'static')]),
    observation('news', viewports[0], [element('section.news', true, 'grid', 'row', '1fr', 'static')]),
    observation('news', viewports[1], [element('section.news', true, 'grid', 'row', '1fr 1fr', 'static')]),
  ];

  const result = buildResponsiveEvidenceResult(observations, viewports);
  let passed = 0;
  expectEqual(result.pages.length, 2, 'observations should group by page'); passed++;
  expectEqual(result.pages[0].observations.length, 2, 'each page should retain both viewport samples'); passed++;
  expectEqual(result.pages[0].comparisons[0].baseline.key, '1440x900', 'largest width should be comparison baseline'); passed++;
  expectEqual(result.pages[0].comparisons[0].target.key, '390x844', 'smaller sample should compare against baseline'); passed++;
  expectEqual(result.pages[0].comparisons[0].changes[0].property, 'visibility', 'grouped comparison should preserve structural diff'); passed++;
  expectEqual(result.pages[1].comparisons[0].changes[0].property, 'grid-template-columns', 'page-specific diffs must stay isolated'); passed++;
  return { passed, total: 6 };
}

function element(
  key: string,
  visible: boolean,
  display: string,
  flexDirection: string,
  gridTemplateColumns: string,
  position: string
): ResponsiveElementSnapshot {
  return {
    key,
    selector: key,
    tag: key.split(/[.#]/)[0] || 'div',
    visible,
    display,
    flexDirection,
    gridTemplateColumns,
    position,
  };
}

function observation(
  slug: string,
  viewport: { width: number; height: number; key: string },
  elements: ResponsiveElementSnapshot[]
): ResponsiveViewportObservation {
  return {
    pageUrl: slug === 'home' ? 'https://fixture.local/' : `https://fixture.local/${slug}`,
    pageSlug: slug,
    pageTitle: slug,
    viewport,
    screenshotPath: `screens/responsive/${slug}--${viewport.key}.png`,
    domElementCount: 100,
    documentWidth: viewport.width,
    documentHeight: 2000,
    horizontalOverflow: false,
    discovery: {
      beforeElementCount: 100,
      afterElementCount: 100,
      beforeHeight: 2000,
      afterHeight: 2000,
      scrollPasses: 1,
      grew: false,
    },
    elements,
  };
}

interface Result { passed: number; total: number }

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Benchmark failed: ${message}`);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectThrows(fn: () => unknown, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Benchmark failed: ${message}`);
}

main();
