import type {
  ComponentCategory,
  ComponentEvidence,
  ComponentEvidenceSource,
  ComponentInfo,
  DesignProfile,
  TailwindPattern,
} from '../types';
import type { DOMComponent } from '../types-ultra';

const DOM_CATEGORY_MAP: Record<DOMComponent['category'], ComponentCategory> = {
  card: 'data-display',
  'list-item': 'data-display',
  'nav-item': 'navigation',
  button: 'data-input',
  badge: 'data-display',
  'form-field': 'data-input',
  unknown: 'other',
};

/**
 * Convert an existing normalized component back into an evidence record.
 * This lets source-code/HTTP observations participate in the same merge path
 * as runtime DOM evidence without changing the legacy extractors yet.
 */
export function componentInfoToEvidence(
  component: ComponentInfo,
  pageUrl?: string
): ComponentEvidence {
  const source: ComponentEvidenceSource = component.filePath === 'html'
    ? 'http-dom'
    : 'source-code';

  const confidence = component.confidence ?? (source === 'source-code' ? 0.95 : 0.85);
  const name = normalizeName(component.name);
  const classFingerprint = [...component.cssClasses].sort().join('.');

  return {
    source,
    pageUrl: source === 'http-dom' ? pageUrl : undefined,
    nameHint: component.name,
    kindHint: inferKindFromComponent(component),
    categoryHint: component.category,
    classes: [...component.cssClasses],
    instances: component.instances ?? 1,
    structureFingerprint: `${component.category}:${name}:${classFingerprint}`,
    htmlSnippet: component.jsxSnippet || undefined,
    confidence,
    reasons: [
      source === 'source-code'
        ? `component implementation found in ${component.filePath}`
        : 'component pattern found in fetched HTML/SPA source',
    ],
  };
}

/** Convert the existing Ultra DOM detector output into the shared evidence model. */
export function domComponentToEvidence(
  component: DOMComponent,
  pageUrl: string
): ComponentEvidence {
  const knownCategory = component.category !== 'unknown';

  return {
    source: 'runtime-dom',
    pageUrl,
    nameHint: component.name,
    kindHint: component.category,
    categoryHint: DOM_CATEGORY_MAP[component.category],
    classes: [...component.commonClasses],
    instances: component.instances,
    structureFingerprint: component.pattern,
    htmlSnippet: component.htmlSnippet,
    confidence: knownCategory ? 0.8 : 0.6,
    reasons: [
      `repeated runtime DOM structure observed ${component.instances} times`,
      knownCategory
        ? `runtime structure classified as ${component.category}`
        : 'runtime structure did not match a semantic component category',
    ],
  };
}

/**
 * Merge independently observed component evidence into normalized components.
 *
 * This intentionally performs conservative deduplication. Exact normalized
 * names are merged. Generic semantic kinds (Button/Card/etc.) may merge with a
 * matching generic component only when category evidence agrees. Distinct
 * runtime patterns stay distinct rather than being over-collapsed.
 */
export function mergeComponentEvidence(
  existingComponents: ComponentInfo[],
  incomingEvidence: ComponentEvidence[],
  defaultPageUrl?: string
): ComponentInfo[] {
  const components = existingComponents.map(component => seedComponentEvidence(component, defaultPageUrl));

  for (const evidence of incomingEvidence) {
    const matchIndex = findMatchingComponentIndex(components, evidence);

    if (matchIndex >= 0) {
      components[matchIndex] = mergeEvidenceIntoComponent(components[matchIndex], evidence);
    } else {
      components.push(componentFromEvidence(evidence));
    }
  }

  return components;
}

/**
 * Merge Ultra runtime DOM evidence directly into the DesignProfile used later
 * by DESIGN.md and SKILL.md writers. This closes the old split where
 * references/COMPONENTS.md knew about runtime components but profile.components
 * did not.
 */
export function mergeRuntimeComponentsIntoProfile(
  profile: DesignProfile,
  domComponents: DOMComponent[],
  pageUrl: string
): void {
  const runtimeEvidence = domComponents.map(component => domComponentToEvidence(component, pageUrl));
  profile.components = mergeComponentEvidence(profile.components, runtimeEvidence, pageUrl);
  profile.componentCategories = buildComponentCategories(profile.components);
}

export function buildComponentCategories(
  components: ComponentInfo[]
): Record<ComponentCategory, string[]> {
  const categories: Record<ComponentCategory, string[]> = {
    layout: [],
    navigation: [],
    'data-display': [],
    'data-input': [],
    feedback: [],
    overlay: [],
    typography: [],
    media: [],
    other: [],
  };

  for (const component of components) {
    if (!categories[component.category].includes(component.name)) {
      categories[component.category].push(component.name);
    }
  }

  return categories;
}

function seedComponentEvidence(component: ComponentInfo, pageUrl?: string): ComponentInfo {
  if (component.evidence?.length) {
    return {
      ...component,
      evidence: [...component.evidence],
      cssClasses: [...component.cssClasses],
      variants: [...component.variants],
      props: [...component.props],
      animationDetails: [...component.animationDetails],
      statePatterns: [...component.statePatterns],
      pages: component.pages ? [...component.pages] : undefined,
      tailwindPatterns: cloneTailwindPattern(component.tailwindPatterns),
    };
  }

  const evidence = componentInfoToEvidence(component, pageUrl);
  const pages = evidence.pageUrl ? [evidence.pageUrl] : component.pages;

  return {
    ...component,
    cssClasses: [...component.cssClasses],
    variants: [...component.variants],
    props: [...component.props],
    animationDetails: [...component.animationDetails],
    statePatterns: [...component.statePatterns],
    tailwindPatterns: cloneTailwindPattern(component.tailwindPatterns),
    instances: component.instances ?? evidence.instances,
    pages: pages ? [...pages] : undefined,
    confidence: component.confidence ?? evidence.confidence,
    evidence: [evidence],
  };
}

function findMatchingComponentIndex(
  components: ComponentInfo[],
  evidence: ComponentEvidence
): number {
  const evidenceName = normalizeName(evidence.nameHint || '');
  const evidenceCategory = evidence.categoryHint || 'other';

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const componentName = normalizeName(component.name);

    if (evidenceName && componentName === evidenceName) {
      return i;
    }

    if (component.category !== evidenceCategory) continue;

    const genericKind = normalizeName(evidence.kindHint || '');
    if (genericKind && isGenericKindMatch(componentName, genericKind)) {
      const classOverlap = overlapRatio(component.cssClasses, evidence.classes);
      const componentIsGeneric = isGenericComponentName(componentName, genericKind);
      if (componentIsGeneric || classOverlap > 0) return i;
    }
  }

  return -1;
}

function mergeEvidenceIntoComponent(
  component: ComponentInfo,
  evidence: ComponentEvidence
): ComponentInfo {
  const pages = new Set(component.pages || []);
  if (evidence.pageUrl) pages.add(evidence.pageUrl);

  const evidenceList = [...(component.evidence || [])];
  if (!evidenceList.some(existing => sameEvidence(existing, evidence))) {
    evidenceList.push(evidence);
  }

  return {
    ...component,
    category: component.category === 'other' && evidence.categoryHint
      ? evidence.categoryHint
      : component.category,
    cssClasses: unique([...component.cssClasses, ...evidence.classes]),
    jsxSnippet: component.jsxSnippet || evidence.htmlSnippet || '',
    instances: Math.max(component.instances ?? 1, evidence.instances),
    pages: pages.size > 0 ? [...pages] : undefined,
    confidence: Math.max(component.confidence ?? 0, evidence.confidence),
    evidence: evidenceList,
  };
}

function componentFromEvidence(evidence: ComponentEvidence): ComponentInfo {
  return {
    name: evidence.nameHint || humanizeKind(evidence.kindHint || 'RuntimeComponent'),
    filePath: runtimeFilePath(evidence),
    variants: [],
    cssClasses: unique(evidence.classes),
    jsxSnippet: evidence.htmlSnippet || '',
    props: [],
    category: evidence.categoryHint || 'other',
    hasAnimation: false,
    animationDetails: [],
    statePatterns: [],
    tailwindPatterns: emptyTailwindPattern(),
    instances: evidence.instances,
    pages: evidence.pageUrl ? [evidence.pageUrl] : undefined,
    confidence: evidence.confidence,
    evidence: [evidence],
  };
}

function inferKindFromComponent(component: ComponentInfo): string {
  const name = normalizeName(component.name);
  if (/button|btn/.test(name)) return 'button';
  if (/card|tile|panel/.test(name)) return 'card';
  if (/nav|menu|tab/.test(name)) return 'nav-item';
  if (/badge|chip|tag/.test(name)) return 'badge';
  if (/input|field|form/.test(name)) return 'form-field';
  if (/list|item|timeline/.test(name)) return 'list-item';
  return component.category;
}

function isGenericKindMatch(componentName: string, kind: string): boolean {
  const aliases: Record<string, RegExp> = {
    button: /^(button|btn)$/,
    card: /^(card|tile|panel)$/,
    'nav-item': /^(navigation|nav|navitem|menu|menuitem|tab)$/,
    badge: /^(badge|chip|tag|label|pill)$/,
    'form-field': /^(input|field|formfield|select|textarea)$/,
    'list-item': /^(list|listitem|item|timeline)$/,
  };
  return aliases[kind]?.test(componentName) ?? componentName === kind;
}

function isGenericComponentName(componentName: string, kind: string): boolean {
  return isGenericKindMatch(componentName, kind);
}

function sameEvidence(a: ComponentEvidence, b: ComponentEvidence): boolean {
  return a.source === b.source
    && a.pageUrl === b.pageUrl
    && a.structureFingerprint === b.structureFingerprint;
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const common = b.filter(value => left.has(value)).length;
  return common / Math.min(a.length, b.length);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function humanizeKind(kind: string): string {
  return kind
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function runtimeFilePath(evidence: ComponentEvidence): string {
  if (evidence.source !== 'runtime-dom') return evidence.source;
  if (!evidence.pageUrl) return 'runtime-dom';

  try {
    const url = new URL(evidence.pageUrl);
    return `runtime-dom:${url.pathname || '/'}`;
  } catch {
    return 'runtime-dom';
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function emptyTailwindPattern(): TailwindPattern {
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

function cloneTailwindPattern(pattern: TailwindPattern): TailwindPattern {
  return {
    backgrounds: [...pattern.backgrounds],
    borders: [...pattern.borders],
    spacing: [...pattern.spacing],
    typography: [...pattern.typography],
    effects: [...pattern.effects],
    layout: [...pattern.layout],
    interactive: [...pattern.interactive],
  };
}
