import type { ComponentInfo, TailwindPattern } from '../types';
import type { DOMComponent } from '../types-ultra';
import {
  buildComponentCategories,
  domComponentToEvidence,
  mergeComponentEvidence,
} from '../extractors/component-evidence';

/**
 * Deterministic baseline for the component-evidence pipeline.
 *
 * This benchmark intentionally does not exercise browser heuristics. It locks
 * down the architecture introduced in PR #4 so detector improvements can be
 * measured later without regressing provenance or deduplication behavior.
 */
function main(): void {
  const pageUrl = 'https://fixture.local/';

  // HTTP already found a generic Button. Runtime should enrich it, not create
  // a second Button record.
  const existing: ComponentInfo[] = [
    component('Button', 'html', 'data-input', ['btn', 'btn-primary']),
  ];

  const runtime: DOMComponent[] = [
    {
      name: 'Button',
      pattern: 'button[btn.btn-primary](span)',
      instances: 3,
      commonClasses: ['btn', 'btn-primary'],
      htmlSnippet: '<button class="btn btn-primary"><span>Play</span></button>',
      category: 'button',
    },
    {
      name: 'Server Card',
      pattern: 'div[server-card](div,div)',
      instances: 4,
      commonClasses: ['server-card'],
      htmlSnippet: '<div class="server-card"><div>Server</div><div>Status</div></div>',
      category: 'card',
    },
    {
      name: 'Nav Item',
      pattern: 'a[nav-item](span)',
      instances: 5,
      commonClasses: ['nav-item'],
      htmlSnippet: '<a class="nav-item"><span>Ranking</span></a>',
      category: 'nav-item',
    },
    {
      name: 'Decorative Cluster',
      pattern: 'div[ornament-cluster](span,span)',
      instances: 3,
      commonClasses: ['ornament-cluster'],
      htmlSnippet: '<div class="ornament-cluster"><span></span><span></span></div>',
      category: 'unknown',
    },
  ];

  const evidence = runtime.map(item => domComponentToEvidence(item, pageUrl));
  const merged = mergeComponentEvidence(existing, evidence, pageUrl);
  const categories = buildComponentCategories(merged);

  expectEqual(merged.length, 4, 'runtime Button must merge with the HTTP Button');

  const button = merged.find(item => item.name === 'Button');
  expect(button, 'Button should remain in the normalized component set');
  expectEqual(button?.instances, 3, 'Button instance count should come from runtime evidence');
  expectEqual(button?.confidence, 0.85, 'strongest HTTP evidence should remain authoritative');
  expectSetEqual(
    button?.evidence?.map(item => item.source) || [],
    ['http-dom', 'runtime-dom'],
    'Button should preserve both HTTP and runtime provenance'
  );

  const serverCard = merged.find(item => item.name === 'Server Card');
  expect(serverCard, 'runtime-only Server Card should be promoted into ComponentInfo');
  expectEqual(serverCard?.category, 'data-display', 'runtime card should map to data-display');
  expectEqual(serverCard?.confidence, 0.8, 'known runtime category should keep baseline confidence');
  expectArrayEqual(serverCard?.pages || [], [pageUrl], 'runtime component should retain page provenance');

  const navItem = merged.find(item => item.name === 'Nav Item');
  expectEqual(navItem?.category, 'navigation', 'runtime nav item should map to navigation');

  const unknown = merged.find(item => item.name === 'Decorative Cluster');
  expectEqual(unknown?.category, 'other', 'unknown runtime structure should stay explicit');
  expectEqual(unknown?.confidence, 0.6, 'unknown runtime structure should keep lower confidence');

  expect(categories['data-input'].includes('Button'), 'component categories should include Button');
  expect(categories['data-display'].includes('Server Card'), 'component categories should include Server Card');
  expect(categories.navigation.includes('Nav Item'), 'component categories should include Nav Item');
  expect(categories.other.includes('Decorative Cluster'), 'component categories should include unknown candidates');

  const expected = new Set([
    signature('Button', 'data-input'),
    signature('Server Card', 'data-display'),
    signature('Nav Item', 'navigation'),
    signature('Decorative Cluster', 'other'),
  ]);
  const actual = new Set(merged.map(item => signature(item.name, item.category)));
  const truePositives = [...actual].filter(item => expected.has(item)).length;
  const precision = truePositives / actual.size;
  const recall = truePositives / expected.size;

  expectEqual(precision, 1, 'synthetic pipeline precision should remain stable');
  expectEqual(recall, 1, 'synthetic pipeline recall should remain stable');

  console.log('Component evidence pipeline benchmark');
  console.log(`  normalized components: ${merged.length}`);
  console.log(`  evidence records:      ${merged.reduce((sum, item) => sum + (item.evidence?.length || 0), 0)}`);
  console.log(`  precision:             ${(precision * 100).toFixed(0)}%`);
  console.log(`  recall:                ${(recall * 100).toFixed(0)}%`);
  console.log('  status:                PASS');
}

function component(
  name: string,
  filePath: string,
  category: ComponentInfo['category'],
  cssClasses: string[]
): ComponentInfo {
  return {
    name,
    filePath,
    variants: [],
    cssClasses,
    jsxSnippet: '',
    props: [],
    category,
    hasAnimation: false,
    animationDetails: [],
    statePatterns: [],
    tailwindPatterns: emptyTailwind(),
  };
}

function emptyTailwind(): TailwindPattern {
  return {
    backgrounds: [],
    borders: [],
    spacing: [],
    typography: [],
    effects: [],
    layout: [],
    interactive: [],
  };
}

function signature(name: string, category: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}:${category}`;
}

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Benchmark failed: ${message}`);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectArrayEqual(actual: string[], expected: string[], message: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Benchmark failed: ${message}. Expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

function expectSetEqual(actual: string[], expected: string[], message: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== expectedSet.size || [...actualSet].some(value => !expectedSet.has(value))) {
    throw new Error(`Benchmark failed: ${message}. Expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

main();
