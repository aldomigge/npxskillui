import type { ComponentInfo, TailwindPattern } from '../types';
import type { DOMComponent } from '../types-ultra';
import {
  buildComponentCategories,
  domComponentToEvidence,
  mergeComponentEvidence,
  shouldPromoteRuntimeEvidence,
} from '../extractors/component-evidence';
import {
  classifyDOMCandidate,
  deriveDOMComponentName,
  type DOMCandidateSummary,
} from '../extractors/ultra/component-classifier';

/**
 * Deterministic baseline for component detection + evidence normalization.
 * Browser collection itself is integration-tested against real sites; semantic
 * classification and the merge/admission pipeline stay deterministic here.
 */
function main(): void {
  const classifierCases = runClassifierBenchmark();
  const pipeline = runEvidencePipelineBenchmark();

  console.log('Runtime component detector benchmark');
  console.log(`  classifier cases:       ${classifierCases.passed}/${classifierCases.total}`);
  console.log(`  raw runtime candidates: ${pipeline.rawEvidence}`);
  console.log(`  promoted candidates:    ${pipeline.promotedEvidence}`);
  console.log(`  normalized components:  ${pipeline.normalizedComponents}`);
  console.log(`  evidence records:       ${pipeline.evidenceRecords}`);
  console.log(`  precision:              ${(pipeline.precision * 100).toFixed(0)}%`);
  console.log(`  recall:                 ${(pipeline.recall * 100).toFixed(0)}%`);
  console.log('  status:                 PASS');
}

function runClassifierBenchmark(): { passed: number; total: number } {
  const cases: Array<{
    label: string;
    candidate: DOMCandidateSummary;
    category: DOMComponent['category'];
    minimumInstances: number;
    name?: string;
  }> = [
    {
      label: 'CSS-module navigation anchor',
      candidate: candidate('a', ['HeaderNavigation_item__gMA78']),
      category: 'nav-item',
      minimumInstances: 1,
      name: 'Header Navigation Item',
    },
    {
      label: 'chip outranks list-item semantics',
      candidate: candidate('li', ['LandingTopSection_chip__X8Z6s']),
      category: 'badge',
      minimumInstances: 1,
      name: 'Landing Top Section Chip',
    },
    {
      label: 'CSS-module hash with underscore is fully stripped',
      candidate: candidate('div', ['RewardItemCard_badge__07_mn']),
      category: 'badge',
      minimumInstances: 1,
      name: 'Reward Item Card Badge',
    },
    {
      label: 'classless native button',
      candidate: { ...candidate('button'), ariaLabel: 'Play' },
      category: 'button',
      minimumInstances: 1,
      name: 'Play Button',
    },
    {
      label: 'ARIA dialog',
      candidate: { ...candidate('div'), role: 'dialog' },
      category: 'dialog',
      minimumInstances: 1,
      name: 'Dialog',
    },
    {
      label: 'native input',
      candidate: { ...candidate('input'), inputType: 'search' },
      category: 'form-field',
      minimumInstances: 1,
      name: 'Search Input',
    },
    {
      label: 'CSS-module card namespace root',
      candidate: candidate('div', ['ServerCard_root__Ab12C']),
      category: 'card',
      minimumInstances: 3,
      name: 'Server Card Root',
    },
    {
      label: 'CSS-module namespace must not poison child semantics',
      candidate: candidate('div', ['RewardItemCard_name__d0nep']),
      category: 'unknown',
      minimumInstances: 3,
      name: 'Reward Item Card Name',
    },
    {
      label: 'card namespace root-like item remains card',
      candidate: candidate('div', ['RewardItemCard_item__hbWbF']),
      category: 'card',
      minimumInstances: 3,
      name: 'Reward Item Card Item',
    },
    {
      label: 'base button class outranks visual variants',
      candidate: candidate('button', [
        'Button_blue__j58BM',
        'Button_btn__t76w6',
        'HeaderRightButtons_text-btn__yYIO4',
      ]),
      category: 'button',
      minimumInstances: 1,
      name: 'Button',
    },
    {
      label: 'navigation link outranks active state class',
      candidate: candidate('a', ['PageNavigation_active__Mi9nd', 'PageNavigation_link__HCmV2']),
      category: 'nav-item',
      minimumInstances: 1,
      name: 'Page Navigation Link',
    },
    {
      label: 'badge namespace label is not itself a badge',
      candidate: candidate('span', ['OnlineBadge_lbl__0bPcK']),
      category: 'unknown',
      minimumInstances: 3,
      name: 'Online Badge Lbl',
    },
    {
      label: 'classless list item stays structural only',
      candidate: candidate('li'),
      category: 'unknown',
      minimumInstances: 3,
      name: 'Li',
    },
    {
      label: 'secondary class can carry actual card identity',
      candidate: candidate('div', [
        'LandingNewBlocks_num-secondary__MFyCd',
        'LandingNewBlocks_reward-big-card__BWxq6',
      ]),
      category: 'card',
      minimumInstances: 3,
      name: 'Landing New Blocks Reward Big Card',
    },
    {
      label: 'layout utility wrapper',
      candidate: candidate('div', ['Flex_flex__KsGCE', 'Flex_a-center__QQrTr']),
      category: 'unknown',
      minimumInstances: 3,
      name: 'Div',
    },
    {
      label: 'ordinary content anchor',
      candidate: candidate('a', ['Article_link__Ab12C']),
      category: 'unknown',
      minimumInstances: 3,
      name: 'Article Link',
    },
  ];

  let passed = 0;
  for (const testCase of cases) {
    const result = classifyDOMCandidate(testCase.candidate);
    expectEqual(result.category, testCase.category, `${testCase.label}: category`);
    expectEqual(result.minimumInstances, testCase.minimumInstances, `${testCase.label}: minimum instances`);
    if (testCase.name) {
      expectEqual(deriveDOMComponentName(testCase.candidate), testCase.name, `${testCase.label}: name`);
    }
    passed++;
  }

  return { passed, total: cases.length };
}

function runEvidencePipelineBenchmark(): {
  rawEvidence: number;
  promotedEvidence: number;
  normalizedComponents: number;
  evidenceRecords: number;
  precision: number;
  recall: number;
} {
  const pageUrl = 'https://fixture.local/';
  const existing: ComponentInfo[] = [
    component('Button', 'html', 'data-input', ['btn', 'btn-primary']),
  ];

  const runtime: DOMComponent[] = [
    {
      name: 'Button',
      pattern: 'button|role=|type=[btn.btn-primary](span{})',
      instances: 3,
      commonClasses: ['btn', 'btn-primary'],
      htmlSnippet: '<button class="btn btn-primary"><span>Play</span></button>',
      category: 'button',
      tag: 'button',
      confidence: 0.98,
      reasons: ['semantic <button> evidence'],
    },
    {
      name: 'Server Card',
      pattern: 'div|role=|type=[server-card](div{},div{})',
      instances: 4,
      commonClasses: ['server-card'],
      htmlSnippet: '<div class="server-card"><div>Server</div><div>Status</div></div>',
      category: 'card',
      tag: 'div',
      confidence: 0.84,
      reasons: ['semantic card/tile/panel class token'],
    },
    {
      name: 'Nav Item',
      pattern: 'a|role=|type=[nav-item](span{})',
      instances: 5,
      commonClasses: ['nav-item'],
      htmlSnippet: '<a class="nav-item"><span>Ranking</span></a>',
      category: 'nav-item',
      tag: 'a',
      confidence: 0.94,
      reasons: ['anchor appears in navigation/menu context'],
    },
    {
      name: 'Decorative Cluster',
      pattern: 'div|role=|type=[ornament-cluster](span{},span{})',
      instances: 3,
      commonClasses: ['ornament-cluster'],
      htmlSnippet: '<div class="ornament-cluster"><span></span><span></span></div>',
      category: 'unknown',
      tag: 'div',
      confidence: 0.55,
      reasons: ['repeated structural pattern without strong semantic evidence'],
    },
    {
      name: 'Flex A Center',
      pattern: 'div|role=|type=[Flex_a-center.Flex_flex.HeaderServerSelector_server-item](img{},div{})',
      instances: 3,
      commonClasses: [
        'Flex_a-center__abc',
        'Flex_flex__def',
        'HeaderServerSelector_server-item__ghi',
      ],
      htmlSnippet: '<div class="Flex_a-center__abc Flex_flex__def HeaderServerSelector_server-item__ghi"></div>',
      category: 'unknown',
      tag: 'div',
      confidence: 0.55,
      reasons: ['repeated structural pattern without strong semantic evidence'],
    },
  ];

  const rawEvidence = runtime.map(item => domComponentToEvidence(item, pageUrl));
  const promotableEvidence = rawEvidence.filter(shouldPromoteRuntimeEvidence);
  const merged = mergeComponentEvidence(existing, promotableEvidence);
  const categories = buildComponentCategories(merged);

  expectEqual(rawEvidence.length, 5, 'all runtime observations should remain available as raw evidence');
  expectEqual(promotableEvidence.length, 3, 'unknown and utility runtime structures must stay non-canonical');
  expectEqual(merged.length, 3, 'runtime Button must merge with HTTP evidence while non-canonical candidates stay out');

  const button = merged.find(item => item.name === 'Button');
  expect(button, 'Button should remain in the normalized component set');
  expectEqual(button?.instances, 3, 'Button instance count should come from runtime evidence');
  expectEqual(button?.confidence, 0.98, 'stronger semantic runtime evidence should become aggregate confidence');
  expectSetEqual(
    button?.evidence?.map(item => item.source) || [],
    ['http-dom', 'runtime-dom'],
    'Button should preserve both HTTP and runtime provenance'
  );
  expectArrayEqual(button?.pages || [], [pageUrl], 'page provenance should come from runtime evidence only');
  expectEqual(button?.evidence?.find(item => item.source === 'runtime-dom')?.tag, 'button', 'runtime tag must survive evidence conversion');

  const serverCard = merged.find(item => item.name === 'Server Card');
  expect(serverCard, 'runtime-only Server Card should be promoted into ComponentInfo');
  expectEqual(serverCard?.category, 'data-display', 'runtime card should map to data-display');
  expectEqual(serverCard?.confidence, 0.84, 'runtime classifier confidence should survive normalization');

  const navItem = merged.find(item => item.name === 'Nav Item');
  expectEqual(navItem?.category, 'navigation', 'runtime nav item should map to navigation');

  expectEqual(merged.find(item => item.name === 'Decorative Cluster'), undefined, 'unknown structures must stay raw');
  expectEqual(merged.find(item => item.name === 'Flex A Center'), undefined, 'utility wrappers must stay raw');

  expect(categories['data-input'].includes('Button'), 'component categories should include Button');
  expect(categories['data-display'].includes('Server Card'), 'component categories should include Server Card');
  expect(categories.navigation.includes('Nav Item'), 'component categories should include Nav Item');
  expectEqual(categories.other.length, 0, 'unknown runtime candidates must not inflate canonical categories');

  const expected = new Set([
    signature('Button', 'data-input'),
    signature('Server Card', 'data-display'),
    signature('Nav Item', 'navigation'),
  ]);
  const actual = new Set(merged.map(item => signature(item.name, item.category)));
  const truePositives = [...actual].filter(item => expected.has(item)).length;
  const precision = truePositives / actual.size;
  const recall = truePositives / expected.size;

  expectEqual(precision, 1, 'synthetic pipeline precision should remain stable');
  expectEqual(recall, 1, 'synthetic pipeline recall should remain stable');

  return {
    rawEvidence: rawEvidence.length,
    promotedEvidence: promotableEvidence.length,
    normalizedComponents: merged.length,
    evidenceRecords: merged.reduce((sum, item) => sum + (item.evidence?.length || 0), 0),
    precision,
    recall,
  };
}

function candidate(
  tag: string,
  classes: string[] = [],
  ancestorTags: string[] = [],
  ancestorRoles: string[] = []
): DOMCandidateSummary {
  return { tag, classes, ancestorTags, ancestorRoles };
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
