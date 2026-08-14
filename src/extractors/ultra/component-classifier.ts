import type { DOMComponent } from '../../types-ultra';

export interface DOMCandidateSummary {
  tag: string;
  role?: string;
  classes: string[];
  ancestorTags: string[];
  ancestorRoles: string[];
  ariaLabel?: string;
  inputType?: string;
}

export interface DOMClassification {
  category: DOMComponent['category'];
  confidence: number;
  reasons: string[];
  minimumInstances: number;
}

interface ClassDescriptor {
  raw: string;
  stripped: string;
  namespace?: string;
  local: string;
  namespaceWords: string[];
  localWords: string[];
}

const INTERACTIVE_FORM_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'spinbutton',
  'slider',
]);

const NAV_ITEM_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem']);
const STATE_STYLE_WORDS = new Set([
  'active', 'disabled', 'selected', 'current', 'open', 'closed', 'hover', 'focus',
  'primary', 'secondary', 'blue', 'yellow', 'red', 'green', 'dark', 'light', 'big',
  'small', 'large', 'color', 'mobile', 'desktop', 'hidden', 'hide', 'show',
]);

/**
 * Classify a rendered DOM candidate using semantic HTML/ARIA first and class
 * naming only as secondary evidence. CSS-module namespaces are context, not
 * component semantics: RewardItemCard_name must not become a card merely
 * because its namespace contains "Card".
 */
export function classifyDOMCandidate(candidate: DOMCandidateSummary): DOMClassification {
  const tag = candidate.tag.toLowerCase();
  const role = (candidate.role || '').toLowerCase();
  const descriptors = candidate.classes.map(describeClass);
  const localWords = new Set(descriptors.flatMap(item => item.localWords));
  const namespaceWords = new Set(descriptors.flatMap(item => item.namespaceWords));
  const hasLocalWord = (...words: string[]): boolean => words.some(word => localWords.has(word));
  const hasNamespaceWord = (...words: string[]): boolean => words.some(word => namespaceWords.has(word));
  const ancestorTags = candidate.ancestorTags.map(value => value.toLowerCase());
  const ancestorRoles = candidate.ancestorRoles.map(value => value.toLowerCase());
  const insideNavigation = ancestorTags.includes('nav')
    || ancestorRoles.includes('navigation')
    || ancestorRoles.includes('menu')
    || hasNamespaceWord('navigation', 'nav', 'menu', 'tab', 'tabs')
    || hasLocalWord('navigation', 'nav', 'menu', 'tab', 'tabs');

  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') {
    return classification('dialog', 0.98, 1, [`semantic ${tag === 'dialog' ? '<dialog>' : `role=${role}`} evidence`]);
  }

  if (tag === 'table' || role === 'table' || role === 'grid') {
    return classification('table', 0.96, 1, [`semantic ${tag === 'table' ? '<table>' : `role=${role}`} evidence`]);
  }

  if (tag === 'nav' || role === 'navigation') {
    return classification('navigation', 0.97, 1, [`semantic ${tag === 'nav' ? '<nav>' : 'role=navigation'} evidence`]);
  }

  if (tag === 'button' || role === 'button') {
    return classification('button', 0.98, 1, [`semantic ${tag === 'button' ? '<button>' : 'role=button'} evidence`]);
  }

  if (['input', 'select', 'textarea'].includes(tag) || INTERACTIVE_FORM_ROLES.has(role)) {
    return classification('form-field', 0.97, 1, [
      tag === 'input' && candidate.inputType
        ? `semantic <input type="${candidate.inputType}"> evidence`
        : `semantic ${role ? `role=${role}` : `<${tag}>`} evidence`,
    ]);
  }

  if (NAV_ITEM_ROLES.has(role)) {
    return classification('nav-item', 0.96, 1, [`semantic role=${role} evidence`]);
  }

  if (tag === 'a' && insideNavigation) {
    return classification('nav-item', 0.94, 1, ['anchor appears in navigation/menu context']);
  }

  if (hasLocalWord('badge', 'chip', 'pill', 'status', 'tag')) {
    return classification('badge', 0.9, 1, ['semantic badge/chip local class token']);
  }

  if (tag === 'li' && insideNavigation) {
    return classification('nav-item', 0.9, 1, ['list item appears in navigation/menu context']);
  }

  if (tag === 'li' && candidate.classes.length === 0) {
    return classification('unknown', 0.6, 3, ['classless <li> is structural evidence without reusable component identity']);
  }

  if (tag === 'li') {
    return classification('list-item', 0.8, 3, ['classed <li> evidence; repetition required']);
  }

  if ((localWords.has('list') && localWords.has('item'))
    || (localWords.has('timeline') && localWords.has('item'))) {
    return classification('list-item', 0.84, 3, ['semantic list-item local class token']);
  }

  if (hasLocalWord('card', 'tile', 'panel') || hasCardNamespaceRoot(descriptors)) {
    return classification('card', 0.84, 3, ['semantic card/tile/panel component-root evidence']);
  }

  if (hasLocalWord('btn', 'button')) {
    return classification('button', 0.82, 3, ['button-like local class token']);
  }

  if (hasLocalWord('field', 'input') || (localWords.has('form') && localWords.has('field'))) {
    return classification('form-field', 0.82, 3, ['form-field-like local class token']);
  }

  return classification('unknown', 0.55, 3, ['repeated structural pattern without strong semantic evidence']);
}

/**
 * Pick the class that best represents component identity rather than whichever
 * class sorts first. This collapses state/style variants such as Button_blue +
 * Button_btn to the stable component name Button, while HeaderNavigation_item
 * remains Header Navigation Item.
 */
export function deriveDOMComponentName(candidate: DOMCandidateSummary): string {
  const category = classifyDOMCandidate(candidate).category;
  const descriptors = candidate.classes
    .map(describeClass)
    .filter(item => !isUtilityClass(item.stripped));

  const semanticClass = descriptors
    .map((descriptor, index) => ({ descriptor, index, score: scoreNameClass(descriptor, category) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.descriptor;

  if (semanticClass) return humanizeClassDescriptor(semanticClass);

  const role = (candidate.role || '').toLowerCase();
  if (role && role !== 'presentation' && role !== 'none') {
    const roleName = humanizeIdentifier(role);
    if (candidate.ariaLabel) return `${cleanLabel(candidate.ariaLabel)} ${roleName}`.trim();
    return roleName;
  }

  const tag = candidate.tag.toLowerCase();
  if (candidate.ariaLabel && ['button', 'a', 'input', 'select', 'textarea'].includes(tag)) {
    return `${cleanLabel(candidate.ariaLabel)} ${humanizeIdentifier(tag)}`.trim();
  }

  if (tag === 'input' && candidate.inputType) {
    return `${humanizeIdentifier(candidate.inputType)} Input`;
  }

  return humanizeIdentifier(tag || 'Runtime Component');
}

/** Strip CSS-module hash suffixes while preserving namespace + local token. */
export function stripCssModuleHash(value: string): string {
  return value
    .replace(/___[-A-Za-z0-9]{4,}$/g, '')
    .replace(/__[-A-Za-z0-9]{4,}$/g, '')
    .trim();
}

function describeClass(raw: string): ClassDescriptor {
  const stripped = stripCssModuleHash(raw);
  const moduleSeparator = stripped.indexOf('_');
  const namespace = moduleSeparator > 0 ? stripped.slice(0, moduleSeparator) : undefined;
  const local = moduleSeparator > 0 ? stripped.slice(moduleSeparator + 1) : stripped;

  return {
    raw,
    stripped,
    namespace,
    local,
    namespaceWords: namespace ? identifierWords(namespace).map(word => word.toLowerCase()) : [],
    localWords: identifierWords(local).map(word => word.toLowerCase()),
  };
}

function hasCardNamespaceRoot(descriptors: ClassDescriptor[]): boolean {
  return descriptors.some(descriptor => {
    const namespaceHasCard = descriptor.namespaceWords.includes('card');
    const localIsRoot = descriptor.localWords.some(word => ['root', 'item', 'container', 'wrapper'].includes(word));
    return namespaceHasCard && localIsRoot;
  });
}

function scoreNameClass(descriptor: ClassDescriptor, category: DOMComponent['category']): number {
  const words = new Set(descriptor.localWords);
  let score = descriptor.namespace ? 10 : 0;

  const preferredByCategory: Partial<Record<DOMComponent['category'], string[]>> = {
    button: ['button', 'btn'],
    'nav-item': ['item', 'link', 'tab', 'menuitem'],
    navigation: ['nav', 'navigation', 'menu'],
    badge: ['badge', 'chip', 'pill', 'status', 'tag'],
    'form-field': ['input', 'field', 'select', 'textarea'],
    card: ['card', 'tile', 'panel', 'item', 'root'],
    'list-item': ['item', 'list', 'timeline'],
    table: ['table', 'grid'],
    dialog: ['dialog', 'modal'],
  };

  const preferred = preferredByCategory[category] || [];
  const hasPreferredWord = preferred.some(word => words.has(word));
  if (hasPreferredWord) score += 100;
  if (descriptor.localWords.length === 1 && preferred.includes(descriptor.localWords[0])) score += 20;
  if ([...words].some(word => STATE_STYLE_WORDS.has(word))) score -= 35;
  if (descriptor.localWords.length === 1 && ['root', 'wrapper', 'container'].includes(descriptor.localWords[0])) score -= 10;
  return score;
}

function humanizeClassDescriptor(descriptor: ClassDescriptor): string {
  if (!descriptor.namespace) return humanizeIdentifier(descriptor.local);

  const namespaceWords = identifierWords(descriptor.namespace);
  const localWords = identifierWords(descriptor.local);
  const namespaceLast = normalizeGenericWord(namespaceWords[namespaceWords.length - 1] || '');
  const localFirst = normalizeGenericWord(localWords[0] || '');

  if (localWords.length === 1 && namespaceLast && namespaceLast === localFirst) {
    return humanizeWords(namespaceWords);
  }

  return humanizeWords([...namespaceWords, ...localWords]);
}

function normalizeGenericWord(value: string): string {
  const word = value.toLowerCase();
  if (word === 'btn') return 'button';
  if (word === 'nav') return 'navigation';
  if (word === 'lbl') return 'label';
  return word;
}

function classification(
  category: DOMComponent['category'],
  confidence: number,
  minimumInstances: number,
  reasons: string[]
): DOMClassification {
  return { category, confidence, minimumInstances, reasons };
}

function isUtilityClass(value: string): boolean {
  return /^(flex|grid|stack|layout|row|col|column|container|wrapper|relative|absolute|inline|block)([-_]|$)/i.test(value);
}

function identifierWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function humanizeIdentifier(value: string): string {
  return humanizeWords(identifierWords(value));
}

function humanizeWords(words: string[]): string {
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}
