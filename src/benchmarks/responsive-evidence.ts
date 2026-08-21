import type {
  PageScreenshot,
  ResponsiveChange,
  ResponsiveElementSnapshot,
  ResponsiveViewportObservation,
} from '../types-ultra';
import {
  buildResponsiveEvidenceResult,
  buildResponsiveSurfacePlan,
  diffResponsiveElements,
  parseResponsiveViewports,
  shouldReportGridTemplateChange,
} from '../extractors/ultra/responsive';
import { summarizeResponsiveChanges } from '../extractors/ultra/responsive-summary';

function main(): void {
  const parsing = runParsingCases();
  const planning = runPlanningCases();
  const diffing = runDiffCases();
  const grouping = runGroupingCases();
  const summarizing = runVisibilitySummaryCases();

  console.log('Responsive runtime evidence benchmark');
  console.log(`  viewport parsing cases: ${parsing.passed}/${parsing.total}`);
  console.log(`  surface planning cases: ${planning.passed}/${planning.total}`);
  console.log(`  structural diff cases: ${diffing.passed}/${diffing.total}`);
  console.log(`  evidence grouping cases: ${grouping.passed}/${grouping.total}`);
  console.log(`  visibility summary cases: ${summarizing.passed}/${summarizing.total}`);
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
    element('section.cards', true, 'grid', 'row', '240px 240px 240px', 'relative'),
    element('div.content', true, 'flex', 'row', 'none', 'static'),
    element('aside.sidebar', true, 'block', 'row', 'none', 'sticky'),
    element('section.fluid-grid', true, 'grid', 'row', '700px', 'static'),
  ];
  const mobile: ResponsiveElementSnapshot[] = [
    element('nav.main', false, 'none', 'row', 'none', 'static'),
    element('button.menu', true, 'block', 'row', 'none', 'fixed'),
    element('section.cards', true, 'grid', 'row', '320px', 'relative'),
    element('div.content', true, 'flex', 'column', 'none', 'static'),
    element('aside.sidebar', true, 'block', 'row', 'none', 'static'),
    element('section.fluid-grid', true, 'grid', 'row', '360px', 'static'),
    element('div.async-only', true, 'block', 'row', 'none', 'static'),
  ];

  const changes = diffResponsiveElements(baseline, mobile);
  let passed = 0;

  expect(changes.some(change => change.selector === 'nav.main' && change.property === 'visibility'), 'nav visibility change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'button.menu' && change.property === 'visibility'), 'menu visibility change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'section.cards' && change.property === 'grid-template-columns'), 'grid track-count change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'div.content' && change.property === 'flex-direction'), 'flex direction change should be detected'); passed++;
  expect(changes.some(change => change.selector === 'aside.sidebar' && change.property === 'position'), 'position change should be detected'); passed++;
  expect(!changes.some(change => change.selector === 'nav.main' && change.property === 'display'), 'hidden element should not emit secondary display noise'); passed++;
  expect(!changes.some(change => change.selector === 'section.fluid-grid' && change.property === 'grid-template-columns'), 'same-track fluid pixel resize should be ignored'); passed++;
  expect(!changes.some(change => change.selector === 'div.async-only'), 'presence-only DOM differences should not be promoted'); passed++;

  expectEqual(
    diffResponsiveElements(
      [element('div.desktop-only', true, 'block', 'row', 'none', 'static')],
      []
    ).length,
    0,
    'DOM disappearance without matched identity should be ignored'
  ); passed++;

  expectEqual(diffResponsiveElements(baseline, baseline).length, 0, 'identical samples should not invent changes'); passed++;
  expectEqual(shouldReportGridTemplateChange('217px 217px', '146px 146px'), false, 'same two-track pixel resize should be fluid'); passed++;
  expectEqual(shouldReportGridTemplateChange('repeat(2, 1fr)', '1fr'), true, 'two tracks collapsing to one should be structural'); passed++;

  return { passed, total: 12 };
}

function runGroupingCases(): Result {
  const viewports = parseResponsiveViewports('390x844,1440x900');
  const observations: ResponsiveViewportObservation[] = [
    observation('home', viewports[0], [element('nav.main', false, 'none', 'row', 'none', 'static')]),
    observation('home', viewports[1], [element('nav.main', true, 'flex', 'row', 'none', 'static')]),
    observation('news', viewports[0], [element('section.news', true, 'grid', 'row', '320px', 'static')]),
    observation('news', viewports[1], [element('section.news', true, 'grid', 'row', '320px 320px', 'static')]),
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

function runVisibilitySummaryCases(): Result {
  const root = 'div.HeaderServerSelector_wrap__FQQW6';
  const changes: ResponsiveChange[] = [
    change(root, 'visibility', 'visible', 'hidden'),
    change(`${root} > div.Flex_flex__KsGCE`, 'visibility', 'visible', 'hidden'),
    change('div.HeaderServerSelector_servers-list__OPYZ6 > div.Flex_flex__KsGCE:nth-of-type(1)', 'visibility', 'visible', 'hidden'),
    change('div.HeaderServerSelector_servers-list__OPYZ6 > div.Flex_flex__KsGCE:nth-of-type(2)', 'visibility', 'visible', 'hidden'),
    change('nav.HeaderNavigation_nav__TI4f3 > a.HeaderNavigation_item__gMA78', 'visibility', 'visible', 'hidden'),
    change('div.HeaderNavigation_mobile__abc > div.HeaderNavigation_mobile-submenu-title__vWqdJ:nth-of-type(1)', 'visibility', 'hidden', 'visible'),
    change('div.HeaderNavigation_mobile__abc > div.HeaderNavigation_mobile-submenu-title__vWqdJ:nth-of-type(2)', 'visibility', 'hidden', 'visible'),
    change('div.AppSocials_wrapper__S5O1p > div.AppSocials_right-side__KEsv7:nth-of-type(1)', 'visibility', 'visible', 'hidden'),
    change('div.AppSocials_wrapper__S5O1p > div.AppSocials_right-side__KEsv7:nth-of-type(2)', 'visibility', 'visible', 'hidden'),
    change('div.AppSocials_wrapper__S5O1p > div.AppSocials_right-side__KEsv7:nth-of-type(3)', 'visibility', 'visible', 'hidden'),
    change('div.AppSocials_content__cSXpe', 'display', 'grid', 'flex'),
  ];

  const summary = summarizeResponsiveChanges(changes);
  let passed = 0;
  expectEqual(summary.omittedVisibilityChanges, 3, 'visibility cascades should report condensed evidence count'); passed++;
  expectEqual(summary.changes.filter(item => item.selector.includes('HeaderServerSelector') && item.property === 'visibility').length, 2, 'one component family/direction should keep at most two visibility representatives'); passed++;
  expect(!summary.changes.some(item => item.selector === `${root} > div.Flex_flex__KsGCE`), 'a descendant shadowed by a retained ancestor should be removed'); passed++;
  expectEqual(summary.changes.filter(item => item.selector.includes('HeaderNavigation_mobile') && item.property === 'visibility').length, 2, 'opposite-direction mobile navigation evidence should remain independently represented'); passed++;
  expect(summary.changes.some(item => item.property === 'display' && item.selector === 'div.AppSocials_content__cSXpe'), 'strong structural changes must never be removed by visibility condensation'); passed++;
  expectEqual(summary.changes.filter(item => item.selector.includes('AppSocials') && item.property === 'visibility').length, 2, 'different component families should retain their own representatives'); passed++;

  const stateful = summarizeResponsiveChanges([
    change('div.swiper-slide:nth-of-type(4) > article.yt-lite', 'visibility', 'hidden', 'visible'),
    change('div.TabsBlock_tab-content__coj7A > article.yt-lite', 'visibility', 'visible', 'hidden'),
    change('div.carousel-track > div.Card_card__abc', 'visibility', 'visible', 'hidden'),
    change('nav.HeaderNavigation_nav__TI4f3', 'visibility', 'visible', 'hidden'),
    change('div.swiper-slide > div.Card_card__abc', 'display', 'grid', 'flex'),
  ]);
  expectEqual(stateful.omittedStatefulVisibilityChanges, 3, 'stateful carousel/tab/media visibility should be excluded and counted separately'); passed++;
  expect(!stateful.changes.some(item => item.selector.includes('yt-lite') && item.property === 'visibility'), 'lazy media visibility should not become a high-confidence responsive claim'); passed++;
  expect(stateful.changes.some(item => item.selector.includes('HeaderNavigation') && item.property === 'visibility'), 'real navigation visibility evidence should remain'); passed++;
  expect(stateful.changes.some(item => item.selector.includes('swiper-slide') && item.property === 'display'), 'strong structural evidence inside a stateful surface must remain'); passed++;

  return { passed, total: 10 };
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

function change(
  selector: string,
  property: ResponsiveChange['property'],
  from: string,
  to: string
): ResponsiveChange {
  return { selector, property, from, to };
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
