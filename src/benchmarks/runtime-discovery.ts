import type { ComponentStyleSnapshot } from '../types';
import type { DOMComponent } from '../types-ultra';
import {
  buildRuntimeDiscoveryUrls,
  buildScrollPositions,
  hasDiscoveryGrowth,
  mergeDOMComponentObservations,
} from '../extractors/ultra/discovery';

function main(): void {
  const pagePlanning = runPagePlanningCases();
  const scrollPlanning = runScrollPlanningCases();
  const aggregation = runAggregationCases();

  console.log('Runtime discovery benchmark');
  console.log(`  page planning cases:    ${pagePlanning.passed}/${pagePlanning.total}`);
  console.log(`  scroll planning cases:  ${scrollPlanning.passed}/${scrollPlanning.total}`);
  console.log(`  aggregation cases:      ${aggregation.passed}/${aggregation.total}`);
  console.log('  status:                 PASS');
}

function runPagePlanningCases(): { passed: number; total: number } {
  const origin = 'https://fixture.local/';
  const urls = buildRuntimeDiscoveryUrls(origin, [
    'https://fixture.local/?utm=campaign',
    'https://fixture.local/docs',
    'https://fixture.local/docs#details',
    'https://fixture.local/pricing?source=nav',
    'https://fixture.local/news',
  ], 3);

  let passed = 0;
  expectEqual(urls.length, 3, 'runtime discovery should respect page limit'); passed++;
  expectEqual(urls[0], origin, 'origin should always remain the first runtime page'); passed++;
  expectEqual(urls[1], 'https://fixture.local/docs', 'query/hash duplicates must not consume page budget'); passed++;
  expectEqual(urls[2], 'https://fixture.local/pricing?source=nav', 'distinct pathname should remain discoverable'); passed++;
  return { passed, total: 4 };
}

function runScrollPlanningCases(): { passed: number; total: number } {
  let passed = 0;

  expectArrayEqual(buildScrollPositions(900, 900, 8), [0], 'one-viewport page should not invent scrolling'); passed++;

  const positions = buildScrollPositions(7200, 900, 8);
  expectEqual(positions[0], 0, 'scroll plan should start at top'); passed++;
  expectEqual(positions[positions.length - 1], 6300, 'scroll plan should include the exact bottom'); passed++;
  expect(positions.length <= 8, 'scroll plan must remain bounded by max steps'); passed++;

  expectEqual(
    hasDiscoveryGrowth(
      { elementCount: 100, documentHeight: 2000 },
      { elementCount: 103, documentHeight: 2000 }
    ),
    true,
    'new DOM nodes should count as lazy growth'
  ); passed++;

  expectEqual(
    hasDiscoveryGrowth(
      { elementCount: 100, documentHeight: 2000 },
      { elementCount: 100, documentHeight: 2001 }
    ),
    false,
    'subpixel-height jitter should not count as lazy growth'
  ); passed++;

  return { passed, total: 6 };
}

function runAggregationCases(): { passed: number; total: number } {
  const baseStyle = styleSnapshot('rgb(0, 131, 231)');
  const alternateStyle = styleSnapshot('rgb(255, 214, 0)');

  const pageOneButton = component('Button', 'button-pattern', 'blue-style', baseStyle, 3);
  pageOneButton.stateEvidence = [{
    state: 'hover',
    style: { ...baseStyle, backgroundColor: 'rgb(20, 152, 248)' },
    changes: [{ property: 'backgroundColor', from: baseStyle.backgroundColor, to: 'rgb(20, 152, 248)' }],
    selector: 'button:nth-of-type(1)',
  }];

  const pageTwoButton = component('Button', 'button-pattern', 'blue-style', baseStyle, 5);
  const pageTwoAlternate = component('Button', 'button-pattern', 'yellow-style', alternateStyle, 1);
  const pageTwoCard = component('Server Card', 'card-pattern', 'card-style', styleSnapshot('rgb(8, 9, 10)'), 4, 'card');

  const merged = mergeDOMComponentObservations([
    { url: 'https://fixture.local/', components: [pageOneButton] },
    { url: 'https://fixture.local/docs', components: [pageTwoButton, pageTwoAlternate, pageTwoCard] },
  ]);

  const blue = merged.find(item => item.pattern === 'button-pattern' && item.styleFingerprint === 'blue-style');
  const yellow = merged.find(item => item.pattern === 'button-pattern' && item.styleFingerprint === 'yellow-style');
  const card = merged.find(item => item.pattern === 'card-pattern');

  let passed = 0;
  expectEqual(merged.length, 3, 'same structure with different measured style must remain distinct raw variants'); passed++;
  expectEqual(blue?.pages?.length, 2, 'same raw variant should aggregate page provenance'); passed++;
  expectEqual(blue?.instances, 5, 'raw instances should remain the per-page maximum'); passed++;
  expectEqual(blue?.totalInstances, 8, 'raw total should sum instances across pages'); passed++;
  expectEqual(blue?.stateEvidence?.length, 1, 'origin interaction state should survive multipage aggregation'); passed++;
  expectEqual(yellow?.pages?.length, 1, 'alternate style variant should remain page-specific'); passed++;
  expectEqual(card?.name, 'Server Card', 'components unique to secondary pages must be retained'); passed++;
  expectEqual(card?.totalInstances, 4, 'single-page raw total should match its page count'); passed++;

  return { passed, total: 8 };
}

function component(
  name: string,
  pattern: string,
  styleFingerprint: string,
  measuredStyle: ComponentStyleSnapshot,
  instances: number,
  category: DOMComponent['category'] = 'button'
): DOMComponent {
  return {
    name,
    pattern,
    instances,
    commonClasses: [name.replace(/\s+/g, '') + '_root__abc'],
    htmlSnippet: `<div>${name}</div>`,
    category,
    tag: category === 'button' ? 'button' : 'div',
    confidence: category === 'button' ? 0.98 : 0.84,
    measuredStyle,
    styleFingerprint,
  };
}

function styleSnapshot(backgroundColor: string): ComponentStyleSnapshot {
  return {
    backgroundColor,
    backgroundImage: 'none',
    color: 'rgb(255, 255, 255)',
    borderColor: 'rgb(0, 0, 0)',
    borderStyle: 'none',
    borderWidth: '0px',
    borderRadius: '8px',
    padding: '8px 16px',
    gap: 'normal',
    boxShadow: 'none',
    textShadow: 'none',
    opacity: '1',
    transform: 'none',
    filter: 'none',
    outline: 'rgb(255, 255, 255) none 0px',
    outlineColor: 'rgb(255, 255, 255)',
    textDecoration: 'none solid rgb(255, 255, 255)',
    transition: '0.2s ease-in-out',
    fontFamily: 'Arial',
    fontSize: '14px',
    fontWeight: '700',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '120px',
    height: '45px',
    cursor: 'pointer',
  };
}

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Benchmark failed: ${message}`);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectArrayEqual(actual: number[], expected: number[], message: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Benchmark failed: ${message}. Expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

main();
