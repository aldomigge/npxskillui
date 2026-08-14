import assert from 'node:assert/strict';
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

  assert.equal(merged.length, 4, 'runtime Button must merge with the HTTP Button');

  const button = merged.find(item => item.name === 'Button');
  assert.ok(button, 'Button should remain in the normalized component set');
  assert.equal(button?.instances, 3);
  assert.equal(button?.confidence, 0.85, 'strongest HTTP evidence should remain authoritative');
  assert.deepEqual(
    new Set(button?.evidence?.map(item => item.source)),
    new Set(['http-dom', 'runtime-dom']),
    'Button should preserve both HTTP and runtime provenance'
  );

  const serverCard = merged.find(item => item.name === 'Server Card');
  assert.ok(serverCard, 'runtime-only Server Card should be promoted into ComponentInfo');
  assert.equal(serverCard?.category, 'data-display');
  assert.equal(serverCard?.confidence, 0.8);
  assert.deepEqual(serverCard?.pages, [pageUrl]);

  const navItem = merged.find(item => item.name === 'Nav Item');
  assert.equal(navItem?.category, 'navigation');

  const unknown = merged.find(item => item.name === 'Decorative Cluster');
  assert.equal(unknown?.category, 'other');
  assert.equal(unknown?.confidence, 0.6);

  assert.ok(categories['data-input'].includes('Button'));
  assert.ok(categories['data-display'].includes('Server Card'));
  assert.ok(categories.navigation.includes('Nav Item'));
  assert.ok(categories.other.includes('Decorative Cluster'));

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

  assert.equal(precision, 1);
  assert.equal(recall, 1);

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

main();
