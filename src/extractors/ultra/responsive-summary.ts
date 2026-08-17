import type { ResponsiveChange } from '../../types-ultra';

const DEFAULT_VISIBILITY_PER_FAMILY = 2;
const UTILITY_FAMILIES = new Set([
  'Flex',
  'Grid',
  'Icon',
  'Button',
  'Input',
  'Stack',
  'Layout',
  'Container',
]);

export interface ResponsiveChangeSummary {
  changes: ResponsiveChange[];
  omittedVisibilityChanges: number;
}

/**
 * Condense visibility cascades without discarding stronger structural changes.
 *
 * A responsive parent/container switch often causes many tracked descendants to
 * flip visible/hidden together. Those descendants are consequences of the same
 * layout decision, not independent responsive rules. Keep a small number of
 * shallow representatives per CSS-module family + transition direction while
 * preserving display/flex/grid/position changes verbatim.
 */
export function summarizeResponsiveChanges(
  changes: ResponsiveChange[],
  maxVisibilityPerFamily = DEFAULT_VISIBILITY_PER_FAMILY
): ResponsiveChangeSummary {
  const indexed = changes.map((change, index) => ({ change, index }));
  const structural = indexed.filter(item => item.change.property !== 'visibility');
  const visibility = indexed.filter(item => item.change.property === 'visibility');

  const groups = new Map<string, typeof visibility>();
  for (const item of visibility) {
    const family = responsiveSelectorFamily(item.change.selector);
    const key = `${family}|${item.change.from}|${item.change.to}`;
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  const keptVisibility: typeof visibility = [];
  const limit = Math.max(1, Math.round(maxVisibilityPerFamily));

  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const depthDiff = selectorDepth(a.change.selector) - selectorDepth(b.change.selector);
      if (depthDiff !== 0) return depthDiff;
      const lengthDiff = a.change.selector.length - b.change.selector.length;
      if (lengthDiff !== 0) return lengthDiff;
      return a.index - b.index;
    });

    const representatives: typeof visibility = [];
    for (const item of ranked) {
      const shadowedByAncestor = representatives.some(parent =>
        isAncestorSelector(parent.change.selector, item.change.selector)
      );
      if (shadowedByAncestor) continue;
      representatives.push(item);
      if (representatives.length >= limit) break;
    }

    keptVisibility.push(...representatives);
  }

  const kept = [...structural, ...keptVisibility].sort((a, b) => a.index - b.index);
  return {
    changes: kept.map(item => item.change),
    omittedVisibilityChanges: Math.max(0, visibility.length - keptVisibility.length),
  };
}

/** Extract the first non-utility CSS-module family from a structural selector. */
export function responsiveSelectorFamily(selector: string): string {
  const classes = [...selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map(match => match[1]);

  for (const className of classes) {
    if (!className.includes('__')) continue;
    const family = className.split('_')[0];
    if (family && !UTILITY_FAMILIES.has(family)) return family;
  }

  for (const className of classes) {
    const family = className.split('_')[0];
    if (family && !UTILITY_FAMILIES.has(family)) return family;
  }

  return selector.split(' > ')[0].replace(/:nth-of-type\([^)]*\)/g, '') || 'unknown';
}

function selectorDepth(selector: string): number {
  return selector.split(' > ').length;
}

function isAncestorSelector(parent: string, child: string): boolean {
  return child.startsWith(`${parent} > `);
}
