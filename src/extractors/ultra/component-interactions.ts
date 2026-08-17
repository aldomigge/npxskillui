import type { ComponentStateEvidence } from '../../types';
import type { DOMComponent, InteractionRecord } from '../../types-ultra';

/**
 * Attach independently captured hover/focus observations to Runtime Component
 * Detector records. Matching is conservative: named components can match by
 * exact semantic name, but generic names such as Button/Input additionally
 * require strong class identity so states from sibling variants are not mixed.
 */
export function attachInteractionsToDOMComponents(
  components: DOMComponent[],
  interactions: InteractionRecord[]
): DOMComponent[] {
  return components.map(component => {
    const matches = interactions
      .map(interaction => ({ interaction, score: matchScore(component, interaction) }))
      .filter(match => match.score >= 5)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) return component;

    const stateEvidence = dedupeStates(matches.flatMap(({ interaction }) => statesFromInteraction(interaction)));
    const strongest = matches[0].interaction;

    return {
      ...component,
      measuredStyle: component.measuredStyle || strongest.defaultStyles,
      stateEvidence: stateEvidence.length > 0 ? stateEvidence : component.stateEvidence,
    };
  });
}

export function matchInteractionToComponent(
  component: DOMComponent,
  interaction: InteractionRecord
): boolean {
  return matchScore(component, interaction) >= 5;
}

function matchScore(component: DOMComponent, interaction: InteractionRecord): number {
  let score = 0;
  let hasPrimaryIdentity = false;

  const componentName = normalize(component.name);
  const interactionName = normalize(interaction.nameHint || '');
  const exactName = Boolean(componentName && interactionName && componentName === interactionName);
  const genericName = isGenericComponentName(componentName);

  if (exactName && !genericName) {
    score += 6;
    hasPrimaryIdentity = true;
  } else if (exactName) {
    // Generic labels like "Button" are shared by multiple style/state variants.
    // They can strengthen a class match but are not sufficient identity alone.
    score += 1;
  }

  const overlap = classOverlap(component.commonClasses, interaction.classes);
  const jaccard = classJaccard(component.commonClasses, interaction.classes);
  const exactClasses = sameClassSet(component.commonClasses, interaction.classes);

  if (exactClasses && component.commonClasses.length > 0) {
    score += 8;
    hasPrimaryIdentity = true;
  } else if (overlap >= 0.75 && jaccard >= 0.8) {
    score += 6;
    hasPrimaryIdentity = true;
  } else if (overlap >= 0.5) {
    // Partial overlap is supporting evidence only. This intentionally rejects
    // enabled/disabled Button variants that merely share their base classes.
    score += 2;
  }

  if (component.tag && interaction.tag && component.tag === interaction.tag) score += 1;
  if (component.role && interaction.role && component.role === interaction.role) score += 1;
  if (categoryCompatible(component.category, interaction.componentType)) score += 1;

  return hasPrimaryIdentity ? score : 0;
}

function statesFromInteraction(interaction: InteractionRecord): ComponentStateEvidence[] {
  const states: ComponentStateEvidence[] = [];

  if (interaction.hoverStyles && interaction.hoverChanges.length > 0) {
    states.push({
      state: 'hover',
      style: interaction.hoverStyles,
      changes: interaction.hoverChanges,
      screenshot: interaction.screenshots.hover,
      label: interaction.label,
      selector: interaction.selector,
    });
  }

  if (interaction.focusStyles && interaction.focusChanges.length > 0) {
    states.push({
      state: 'focus',
      style: interaction.focusStyles,
      changes: interaction.focusChanges,
      screenshot: interaction.screenshots.focus,
      label: interaction.label,
      selector: interaction.selector,
    });
  }

  return states;
}

function dedupeStates(states: ComponentStateEvidence[]): ComponentStateEvidence[] {
  const seen = new Set<string>();
  const result: ComponentStateEvidence[] = [];

  for (const state of states) {
    const changeFingerprint = state.changes
      .map(change => `${change.property}:${change.from}->${change.to}`)
      .sort()
      .join('|');
    const key = `${state.state}|${state.selector || ''}|${changeFingerprint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(state);
  }

  return result;
}

function classOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const common = right.filter(className => leftSet.has(className)).length;
  return common / Math.min(left.length, right.length);
}

function classJaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const union = new Set([...left, ...right]);
  const rightSet = new Set(right);
  const common = new Set(left.filter(className => rightSet.has(className))).size;
  return common / union.size;
}

function sameClassSet(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(className => rightSet.has(className));
}

function isGenericComponentName(name: string): boolean {
  return new Set([
    'button',
    'btn',
    'input',
    'field',
    'formfield',
    'link',
    'navitem',
    'menuitem',
    'tab',
  ]).has(name);
}

function categoryCompatible(
  category: DOMComponent['category'],
  interactionType: InteractionRecord['componentType']
): boolean {
  if (category === 'button') return interactionType === 'button' || interactionType === 'role-button';
  if (category === 'nav-item') return interactionType === 'link';
  if (category === 'form-field') return interactionType === 'input';
  return false;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
