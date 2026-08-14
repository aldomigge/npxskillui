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

/**
 * Classify a rendered DOM candidate using semantic HTML/ARIA first and class
 * naming only as secondary evidence. High-confidence semantic elements may be
 * retained even when they are unique; class/structure-only candidates still
 * require repetition.
 */
export function classifyDOMCandidate(candidate: DOMCandidateSummary): DOMClassification {
  const tag = candidate.tag.toLowerCase();
  const role = (candidate.role || '').toLowerCase();
  const normalizedClasses = candidate.classes.map(stripCssModuleHash);
  const classWords = new Set(
    normalizedClasses.flatMap(identifierWords).map(word => word.toLowerCase())
  );
  const hasClassWord = (...words: string[]): boolean => words.some(word => classWords.has(word));
  const ancestorTags = candidate.ancestorTags.map(value => value.toLowerCase());
  const ancestorRoles = candidate.ancestorRoles.map(value => value.toLowerCase());
  const insideNavigation = ancestorTags.includes('nav')
    || ancestorRoles.includes('navigation')
    || ancestorRoles.includes('menu')
    || hasClassWord('navigation', 'nav', 'menu', 'tab', 'tabs');

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

  // A link is only treated as navigation when context supports that meaning.
  // This prevents every ordinary content link from becoming a canonical nav item.
  if (tag === 'a' && insideNavigation) {
    return classification('nav-item', 0.94, 1, ['anchor appears in navigation/menu context']);
  }

  // Class semantics come after native/ARIA semantics. Specific chips/badges must
  // win over generic list-item signals such as an enclosing <li>.
  if (hasClassWord('badge', 'chip', 'pill', 'status', 'tag')) {
    return classification('badge', 0.9, 1, ['semantic badge/chip class token']);
  }

  if (tag === 'li' && insideNavigation) {
    return classification('nav-item', 0.9, 1, ['list item appears in navigation/menu context']);
  }

  if (tag === 'li') {
    return classification('list-item', 0.86, 3, ['semantic <li> evidence; repetition required for generic list items']);
  }

  if ((classWords.has('list') && classWords.has('item'))
    || (classWords.has('timeline') && classWords.has('item'))) {
    return classification('list-item', 0.84, 3, ['semantic list-item class token']);
  }

  // Deliberately avoid the old generic /item/ card rule. "item" is far too
  // broad and was the reason navigation entries were classified as cards.
  if (hasClassWord('card', 'tile', 'panel')) {
    return classification('card', 0.84, 3, ['semantic card/tile/panel class token']);
  }

  if (hasClassWord('btn', 'button')) {
    return classification('button', 0.82, 3, ['button-like class token']);
  }

  if (hasClassWord('field', 'input') || (classWords.has('form') && classWords.has('field'))) {
    return classification('form-field', 0.82, 3, ['form-field-like class token']);
  }

  return classification('unknown', 0.55, 3, ['repeated structural pattern without strong semantic evidence']);
}

export function deriveDOMComponentName(candidate: DOMCandidateSummary): string {
  const semanticClass = candidate.classes
    .map(stripCssModuleHash)
    .find(value => !isUtilityClass(value));

  if (semanticClass) return humanizeIdentifier(semanticClass);

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

/** Strip CSS-module hash suffixes while preserving the semantic namespace. */
export function stripCssModuleHash(value: string): string {
  return value
    .replace(/___[-A-Za-z0-9]{4,}$/g, '')
    .replace(/__[-A-Za-z0-9]{4,}$/g, '')
    .trim();
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
  return identifierWords(value)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}
