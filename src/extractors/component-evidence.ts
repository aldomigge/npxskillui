import type {
  ComponentCategory,
  ComponentEvidence,
  ComponentEvidenceSource,
  ComponentInfo,
  ComponentStateEvidence,
  DesignProfile,
  TailwindPattern,
} from '../types';
import type { DOMComponent } from '../types-ultra';

const MIN_RUNTIME_PROMOTION_CONFIDENCE = 0.75;
const LAYOUT_UTILITY_CLASS_PATTERNS = [
  /^Flex_/i,
  /^Grid_/i,
  /^Stack_/i,
  /^Layout_/i,
];

const DOM_CATEGORY_MAP: Record<DOMComponent['category'], ComponentCategory> = {
  card: 'data-display',
  'list-item': 'data-display',
  'nav-item': 'navigation',
  navigation: 'navigation',
  button: 'data-input',
  badge: 'data-display',
  'form-field': 'data-input',
  table: 'data-display',
  dialog: 'overlay',
  unknown: 'other',
};

/**
 * Convert an existing normalized component back into an evidence record.
 * This lets source-code/HTTP observations participate in the same merge path
 * as runtime DOM evidence without changing the legacy extractors yet.
 *
 * pageUrl must only be supplied when the caller actually knows which page
 * produced the observation. Legacy HTTP crawling currently aggregates pages,
 * so callers should leave it undefined rather than inventing provenance.
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
    measuredStyle: component.measuredStyle,
    stateEvidence: component.stateEvidence ? [...component.stateEvidence] : undefined,
    htmlSnippet: component.jsxSnippet || undefined,
    confidence,
    reasons: [
      source === 'source-code'
        ? `component implementation found in ${component.filePath}`
        : 'component pattern found in fetched HTML/SPA source',
    ],
  };
}

/** Convert Runtime Component Detector output into the shared evidence model. */
export function domComponentToEvidence(
  component: DOMComponent,
  pageUrl: string
): ComponentEvidence {
  const knownCategory = component.category !== 'unknown';
  const confidence = component.confidence ?? (knownCategory ? 0.8 : 0.6);
  const observedReason = component.instances === 1
    ? 'runtime DOM structure observed once with strong semantic evidence'
    : `runtime DOM structure observed ${component.instances} times`;

  return {
    source: 'runtime-dom',
    pageUrl,
    tag: component.tag,
    role: component.role,
    nameHint: component.name,
    kindHint: component.category,
    categoryHint: DOM_CATEGORY_MAP[component.category],
    classes: [...component.commonClasses],
    attributes: component.attributes
      ? {
          ariaLabel: component.attributes.ariaLabel,
          ariaRole: component.attributes.ariaRole,
        }
      : undefined,
    instances: component.instances,
    structureFingerprint: component.pattern,
    styleFingerprint: component.styleFingerprint,
    measuredStyle: component.measuredStyle,
    stateEvidence: component.stateEvidence ? [...component.stateEvidence] : undefined,
    htmlSnippet: component.htmlSnippet,
    confidence,
    reasons: [
      observedReason,
      ...(component.reasons?.length
        ? component.reasons
        : [
            knownCategory
              ? `runtime structure classified as ${component.category}`
              : 'runtime structure did not match a semantic component category',
          ]),
      ...(component.measuredStyle ? ['representative default computed style measured from rendered DOM'] : []),
      ...(component.stateEvidence?.length ? [`${component.stateEvidence.length} interaction state observation(s) matched to component`] : []),
    ],
  };
}

/**
 * Decide whether a runtime observation is strong enough to become a canonical
 * DesignProfile component. Raw Ultra observations are still preserved in
 * references/COMPONENTS.md even when they are not promoted here.
 */
export function shouldPromoteRuntimeEvidence(evidence: ComponentEvidence): boolean {
  if (evidence.source !== 'runtime-dom') return true;
  if (evidence.categoryHint === 'other') return false;
  if (evidence.confidence < MIN_RUNTIME_PROMOTION_CONFIDENCE) return false;
  if (isLayoutUtilityWrapper(evidence)) return false;
  return true;
}

/**
 * Merge independently observed component evidence into normalized components.
 *
 * This intentionally performs conservative deduplication. Exact normalized
 * names are merged. Generic semantic kinds (Button/Card/etc.) may merge with a
 * matching generic component only when category evidence agrees. Distinct
 * runtime patterns stay distinct as evidence even when they normalize to one
 * canonical component name.
 */
export function mergeComponentEvidence(
  existingComponents: ComponentInfo[],
  incomingEvidence: ComponentEvidence[]
): ComponentInfo[] {
  const components = existingComponents.map(component => seedComponentEvidence(component));

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

/** Merge qualified runtime DOM evidence into the canonical DesignProfile. */
export function mergeRuntimeComponentsIntoProfile(
  profile: DesignProfile,
  domComponents: DOMComponent[],
  pageUrl: string
): void {
  const runtimeEvidence = domComponents.map(component => domComponentToEvidence(component, pageUrl));
  const promotableEvidence = runtimeEvidence.filter(shouldPromoteRuntimeEvidence);
  profile.components = mergeComponentEvidence(profile.components, promotableEvidence);
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

function seedComponentEvidence(component: ComponentInfo): ComponentInfo {
  if (component.evidence?.length) {
    const measured = summarizeMeasuredEvidence(component.evidence);
    return {
      ...component,
      evidence: [...component.evidence],
      cssClasses: [...component.cssClasses],
      variants: [...component.variants],
      props: [...component.props],
      animationDetails: [...component.animationDetails],
      statePatterns: [...component.statePatterns],
      pages: component.pages ? [...component.pages] : undefined,
      measuredStyle: measured.measuredStyle,
      stateEvidence: measured.stateEvidence,
      tailwindPatterns: cloneTailwindPattern(component.tailwindPatterns),
    };
  }

  const evidence = componentInfoToEvidence(component);

  return {
    ...component,
    cssClasses: [...component.cssClasses],
    variants: [...component.variants],
    props: [...component.props],
    animationDetails: [...component.animationDetails],
    statePatterns: [...component.statePatterns],
    tailwindPatterns: cloneTailwindPattern(component.tailwindPatterns),
    instances: component.instances ?? evidence.instances,
    pages: component.pages ? [...component.pages] : undefined,
    confidence: component.confidence ?? evidence.confidence,
    measuredStyle: component.measuredStyle,
    stateEvidence: component.stateEvidence ? [...component.stateEvidence] : undefined,
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

    const genericKind = (evidence.kindHint || '').toLowerCase();
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

  const measured = summarizeMeasuredEvidence(evidenceList);

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
    // Flatten only when all measured runtime observations agree on one style.
    // Conflicting variants remain available in evidence[] and must not be
    // presented as one universal canonical default/state pair.
    measuredStyle: measured.measuredStyle,
    stateEvidence: measured.stateEvidence,
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
    measuredStyle: evidence.measuredStyle,
    stateEvidence: evidence.stateEvidence ? [...evidence.stateEvidence] : undefined,
    evidence: [evidence],
  };
}

function summarizeMeasuredEvidence(evidenceList: ComponentEvidence[]): {
  measuredStyle?: ComponentInfo['measuredStyle'];
  stateEvidence?: ComponentStateEvidence[];
} {
  const measured = evidenceList.filter(evidence => evidence.measuredStyle);
  if (measured.length === 0) return {};

  const byStyle = new Map<string, ComponentEvidence[]>();
  for (const evidence of measured) {
    const key = measuredStyleKey(evidence);
    const group = byStyle.get(key) || [];
    group.push(evidence);
    byStyle.set(key, group);
  }

  if (byStyle.size !== 1) {
    // Multiple measured variants: keep them on their individual evidence
    // records instead of manufacturing a misleading aggregate default/state.
    return {};
  }

  const group = [...byStyle.values()][0];
  return {
    measuredStyle: group[0].measuredStyle,
    stateEvidence: mergeStateEvidence(
      undefined,
      group.flatMap(evidence => evidence.stateEvidence || [])
    ),
  };
}

function measuredStyleKey(evidence: ComponentEvidence): string {
  if (evidence.styleFingerprint) return evidence.styleFingerprint;
  const style = evidence.measuredStyle;
  if (!style) return 'unmeasured';
  return Object.keys(style)
    .sort()
    .map(key => `${key}:${style[key as keyof typeof style]}`)
    .join('|');
}

function inferKindFromComponent(component: ComponentInfo): string {
  const name = normalizeName(component.name);
  if (/button|btn/.test(name)) return 'button';
  if (/card|tile|panel/.test(name)) return 'card';
  if (/nav|menu|tab/.test(name)) return 'nav-item';
  if (/badge|chip|tag/.test(name)) return 'badge';
  if (/input|field|form/.test(name)) return 'form-field';
  if (/table|grid/.test(name)) return 'table';
  if (/dialog|modal|drawer/.test(name)) return 'dialog';
  if (/list|item|timeline/.test(name)) return 'list-item';
  return component.category;
}

function isGenericKindMatch(componentName: string, kind: string): boolean {
  const aliases: Record<string, RegExp> = {
    button: /^(button|btn)$/,
    card: /^(card|tile|panel)$/,
    navigation: /^(navigation|nav|menu)$/,
    'nav-item': /^(navigation|nav|navitem|menu|menuitem|tab)$/,
    badge: /^(badge|chip|tag|label|pill)$/,
    'form-field': /^(input|field|formfield|select|textarea)$/,
    table: /^(table|grid|datatable)$/,
    dialog: /^(dialog|modal|drawer|overlay)$/,
    'list-item': /^(list|listitem|item|timeline)$/,
  };
  return aliases[kind]?.test(componentName) ?? componentName === normalizeName(kind);
}

function isGenericComponentName(componentName: string, kind: string): boolean {
  return isGenericKindMatch(componentName, kind);
}

function isLayoutUtilityWrapper(evidence: ComponentEvidence): boolean {
  if (evidence.classes.length === 0) return false;

  const utilityClasses = evidence.classes.filter(className =>
    LAYOUT_UTILITY_CLASS_PATTERNS.some(pattern => pattern.test(className))
  );
  const utilityRatio = utilityClasses.length / evidence.classes.length;
  const name = normalizeName(evidence.nameHint || '');
  const utilityLikeName = /^(flex|grid|stack|layout|row|column|container|wrapper|center)/.test(name);

  return utilityLikeName && utilityRatio >= 0.5;
}

function sameEvidence(a: ComponentEvidence, b: ComponentEvidence): boolean {
  return a.source === b.source
    && a.pageUrl === b.pageUrl
    && a.structureFingerprint === b.structureFingerprint;
}

function mergeStateEvidence(
  left?: ComponentStateEvidence[],
  right?: ComponentStateEvidence[]
): ComponentStateEvidence[] | undefined {
  const all = [...(left || []), ...(right || [])];
  if (all.length === 0) return undefined;

  const seen = new Set<string>();
  return all.filter(state => {
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
