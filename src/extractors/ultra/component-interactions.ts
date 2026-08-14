import type { ComponentStateEvidence } from '../../types';
import type { DOMComponent, InteractionRecord } from '../../types-ultra';

/**
 * Attach independently captured hover/focus observations to Runtime Component
 * Detector records. Matching is conservative: exact normalized names and/or
 * stable class overlap are the primary identity signals; tag/category only
 * strengthen an existing match and are not sufficient on their own.
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
  const componentName = normalize(component.name);
  const interactionName = normalize(interaction.nameHint || '');

  if (componentName && interactionName && componentName === interactionName) score += 6;

  const overlap = classOverlap(component.commonClasses, interaction.classes);
  if (overlap > 0) score += 2 + overlap * 6;

  if (component.tag && interaction.tag && component.tag === interaction.tag) score += 1;
  if (component.role && interaction.role && component.role === interaction.role) score += 1;
  if (categoryCompatible(component.category, interaction.componentType)) score += 1;

  return score;
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
