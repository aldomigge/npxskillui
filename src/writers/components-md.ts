import type { DOMComponent, RuntimeDiscoveryPage } from '../types-ultra';
import type {
  ComponentInfo,
  ComponentStateEvidence,
  ComponentStyleSnapshot,
  DesignProfile,
} from '../types';

interface MeasuredObservation {
  classes: string[];
  instances: number;
  style: ComponentStyleSnapshot;
  states?: ComponentStateEvidence[];
  structureFingerprint?: string;
  styleFingerprint?: string;
  pages: string[];
}

/**
 * Generate references/COMPONENTS.md
 *
 * Keeps evidence layers explicit:
 * - canonical components promoted into DesignProfile
 * - measured runtime style variants/states attached to their exact observations
 * - multipage provenance for canonical and raw evidence
 * - raw runtime DOM candidates emitted by the detector
 */
export function generateComponentsMd(
  domComponents: DOMComponent[],
  profile: DesignProfile,
  runtimeDiscovery: RuntimeDiscoveryPage[] = []
): string {
  let md = `# Component Reference\n\n`;
  md += `> Canonical components are observations promoted into the normalized design profile.\n`;
  md += `> Measured styles come from rendered runtime observations and outrank token-derived recipes.\n`;
  md += `> Multiple measured variants of one canonical component remain separate; do not mix their default/hover/focus states.\n`;
  md += `> Runtime evidence may come from multiple crawled pages after bounded scroll/lazy-load stabilization.\n`;
  md += `> Raw runtime DOM candidates are detector observations for inspection; they are not automatically canonical components.\n\n`;

  if (runtimeDiscovery.length > 0) {
    md += `## Runtime Discovery Coverage\n\n`;
    md += `The component detector reused the successfully crawled page corpus. Each page was scrolled in bounded passes and returned to the top before default styles were measured.\n\n`;
    md += `| Page | Raw Patterns | Scroll Passes | DOM Elements | Height | Lazy Growth |\n`;
    md += `|------|--------------|---------------|--------------|--------|-------------|\n`;
    for (const page of runtimeDiscovery) {
      const stats = page.discovery;
      const elementDelta = stats.afterElementCount - stats.beforeElementCount;
      const heightDelta = stats.afterHeight - stats.beforeHeight;
      const growth = stats.grew
        ? `yes (+${Math.max(0, elementDelta)} elements, +${Math.max(0, heightDelta)}px)`
        : 'no';
      md += `| \`${page.url}\` | ${page.componentCount} | ${stats.scrollPasses} | ${stats.beforeElementCount} → ${stats.afterElementCount} | ${stats.beforeHeight}px → ${stats.afterHeight}px | ${growth} |\n`;
    }
    md += `\n`;
  }

  // ── Canonical inventory ─────────────────────────────────────────────
  md += `## Canonical Components\n\n`;

  if (profile.components.length === 0) {
    md += `No component observations were promoted into the canonical design profile.\n\n`;
  } else {
    md += `These are the component records that downstream DESIGN.md / SKILL.md guidance may treat as extracted component evidence. Instance count is the highest count observed on one page, not a sum across pages.\n\n`;
    md += `| Component | Category | Confidence | Max/Page | Pages | Measured | States | Evidence Sources |\n`;
    md += `|-----------|----------|------------|----------|-------|----------|--------|------------------|\n`;

    for (const component of profile.components) {
      const confidence = component.confidence != null
        ? `${Math.round(component.confidence * 100)}%`
        : 'n/a';
      const instances = component.instances != null ? `${component.instances}×` : 'n/a';
      const pageCount = component.pages?.length || 0;
      const sources = component.evidence?.length
        ? [...new Set(component.evidence.map(e => e.source))].join(', ')
        : inferLegacySource(component.filePath);
      const observations = getMeasuredObservations(component);
      const measured = observations.length === 0
        ? 'no'
        : observations.length === 1
          ? '1 observation'
          : `${observations.length} variants`;
      const states = observations.length > 0
        ? [...new Set(observations.flatMap(observation => observation.states || []).map(state => state.state))].join(', ') || 'none'
        : 'none';

      md += `| **${component.name}** | ${component.category} | ${confidence} | ${instances} | ${pageCount || 'n/a'} | ${measured} | ${states} | ${sources} |\n`;
    }
    md += `\n`;
  }

  // ── Canonical measured styles ────────────────────────────────────────
  const measuredCanonical = profile.components.filter(component => getMeasuredObservations(component).length > 0);
  if (measuredCanonical.length > 0) {
    md += `## Canonical Measured Component Styles\n\n`;
    md += `> Values below come from \`getComputedStyle()\` on runtime instances. Use these before any token-derived recipe. Width/height are observed geometry at the extraction viewport, not fixed implementation requirements. When one canonical component has multiple measured variants, preserve each variant and its matched states separately.\n\n`;

    for (const component of measuredCanonical) {
      md += renderCanonicalMeasuredComponent(component);
    }
  }

  // ── Raw runtime-DOM inventory ───────────────────────────────────────
  md += `## Raw Runtime DOM Candidates\n\n`;
  md += `> High-confidence semantic HTML/ARIA observations may appear once. Structural/class-only candidates require repetition. Raw candidates remain evidence even when the promotion policy rejects them. \`Max/Page\` is the largest per-page count; \`Total\` is the sum across pages for this exact structure + measured-style observation.\n\n`;

  if (domComponents.length === 0) {
    md += `No runtime DOM candidates detected (Playwright required).\n`;
    return md;
  }

  md += `| Candidate | Detector Category | Confidence | Max/Page | Total | Pages | Measured | States | Semantic | Key Classes |\n`;
  md += `|-----------|-------------------|------------|----------|-------|-------|----------|--------|----------|-------------|\n`;
  for (const component of domComponents) {
    const classes = component.commonClasses.slice(0, 3).map(className => `\`.${className}\``).join(', ');
    const confidence = component.confidence != null ? `${Math.round(component.confidence * 100)}%` : 'n/a';
    const semantic = [component.tag ? `<${component.tag}>` : '', component.role ? `role=${component.role}` : '']
      .filter(Boolean)
      .join(' / ') || 'class/structure';
    const measured = component.measuredStyle ? 'yes' : 'no';
    const states = component.stateEvidence?.length
      ? [...new Set(component.stateEvidence.map(state => state.state))].join(', ')
      : 'none';
    const total = component.totalInstances ?? component.instances;
    const pageCount = component.pages?.length || 1;
    md += `| **${component.name}** | ${component.category} | ${confidence} | ${component.instances}× | ${total}× | ${pageCount} | ${measured} | ${states} | ${semantic} | ${classes} |\n`;
  }
  md += `\n`;

  // ── Category Groups ─────────────────────────────────────────────────
  const byCategory = groupBy(domComponents, component => component.category);
  const categoryOrder: DOMComponent['category'][] = [
    'navigation', 'nav-item', 'button', 'form-field', 'dialog', 'table',
    'badge', 'card', 'list-item', 'unknown'
  ];

  const accent = profile.colors.find(color => color.role === 'accent');
  const bg = profile.colors.find(color => color.role === 'background');
  const surface = profile.colors.find(color => color.role === 'surface');
  const border = profile.colors.find(color => color.role === 'border');
  const textPrimary = profile.colors.find(color => color.role === 'text-primary');
  const commonRadius = profile.borderRadius.filter(radius => !radius.includes('9999'))[
    Math.floor(profile.borderRadius.length / 2)
  ] || '8px';

  for (const category of categoryOrder) {
    const components = byCategory[category];
    if (!components?.length) continue;

    md += `## Raw ${formatCategory(category)}\n\n`;

    for (const component of components) {
      md += `### ${component.name}\n\n`;
      md += `**Max instances on one page:** ${component.instances}\n\n`;
      if ((component.totalInstances ?? component.instances) !== component.instances) {
        md += `**Total instances across observed pages:** ${component.totalInstances}\n\n`;
      }
      if (component.pages?.length) {
        md += `**Observed pages (${component.pages.length}):** ${component.pages.map(page => `\`${page}\``).join(', ')}\n\n`;
      }
      if (component.confidence != null) md += `**Detector confidence:** ${Math.round(component.confidence * 100)}%\n\n`;
      if (component.tag || component.role) {
        md += `**Semantic evidence:** ${component.tag ? `\`<${component.tag}>\`` : ''}${component.tag && component.role ? ', ' : ''}${component.role ? `\`role=${component.role}\`` : ''}\n\n`;
      }
      if (component.reasons?.length) {
        md += `**Why classified this way:** ${component.reasons.join('; ')}\n\n`;
      }

      if (component.commonClasses.length > 0) {
        md += `**CSS classes:** ${component.commonClasses.map(className => `\`.${className}\``).join(' ')}\n\n`;
      }

      md += `**HTML structure:**\n\n`;
      md += `\`\`\`html\n`;
      md += `${component.htmlSnippet}\n`;
      md += `\`\`\`\n\n`;

      if (component.measuredStyle) {
        md += `**Measured default style (this runtime observation):**\n\n`;
        md += renderMeasuredStyleBlock(component.measuredStyle);
        md += `**Observed geometry:** ${component.measuredStyle.width} × ${component.measuredStyle.height}\n\n`;
        md += renderStates(component.stateEvidence);
      } else {
        const suggestedCss = buildSuggestedCss(component, {
          accent, bg, surface, border, textPrimary, commonRadius, profile
        });
        if (suggestedCss) {
          md += `**Token-derived implementation starting point (measured runtime style unavailable):**\n\n`;
          md += `\`\`\`css\n`;
          md += suggestedCss;
          md += `\`\`\`\n\n`;
        }
      }
    }
  }

  // ── Evidence Rules ──────────────────────────────────────────────────
  md += `## Component Evidence Rules\n\n`;
  md += `- Treat the **Canonical Components** table as the normalized component inventory.\n`;
  md += `- **Measured component styles and matched hover/focus states outrank token-derived recipes.**\n`;
  md += `- Page provenance matters: a component may be global or route-specific; do not assume one-page observations are universal.\n`;
  md += `- Canonical instance counts are per-page maxima. Raw totals are separately labeled and must not be confused with simultaneous instances.\n`;
  md += `- When a canonical component has multiple measured variants, keep each default style and its hover/focus states together; do not merge them into one synthetic style.\n`;
  md += `- Width/height measurements describe the observed extraction viewport; do not blindly hard-code them.\n`;
  md += `- Treat **Raw Runtime DOM Candidates** as detector evidence, not proof that every candidate is a reusable component.\n`;
  md += `- Native HTML and explicit ARIA semantics outrank class-name guesses.\n`;
  md += `- Utility wrappers and unclassified substructures may remain in the raw inventory without being promoted.\n`;
  md += `- Use raw HTML/classes to validate canonical components and screenshot structure; do not promote a raw candidate by assumption.\n`;
  md += `- Token-derived CSS is fallback guidance only when measured runtime styling is unavailable.\n`;
  if (border) md += `- Extracted border token: \`${border.hex}\`.\n`;
  if (accent) md += `- Extracted accent token: \`${accent.hex}\`.\n`;
  md += `\n`;

  return md;
}

function getMeasuredObservations(component: ComponentInfo): MeasuredObservation[] {
  const runtimeEvidence = (component.evidence || [])
    .filter(evidence => evidence.source === 'runtime-dom' && evidence.measuredStyle)
    .map(evidence => ({
      classes: [...evidence.classes],
      instances: evidence.instances,
      style: evidence.measuredStyle!,
      states: evidence.stateEvidence ? [...evidence.stateEvidence] : undefined,
      structureFingerprint: evidence.structureFingerprint,
      styleFingerprint: evidence.styleFingerprint,
      pages: evidence.pageUrl ? [evidence.pageUrl] : [],
    }));

  const observations: MeasuredObservation[] = runtimeEvidence.length > 0
    ? runtimeEvidence
    : component.measuredStyle
      ? [{
          classes: [...component.cssClasses],
          instances: component.instances || 1,
          style: component.measuredStyle,
          states: component.stateEvidence ? [...component.stateEvidence] : undefined,
          pages: component.pages ? [...component.pages] : [],
        }]
      : [];

  const grouped = new Map<string, MeasuredObservation>();
  for (const observation of observations) {
    const key = `${observation.structureFingerprint || ''}|${observation.styleFingerprint || styleKey(observation.style)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...observation,
        classes: [...observation.classes],
        states: observation.states ? [...observation.states] : undefined,
        pages: [...observation.pages],
      });
      continue;
    }

    existing.instances = Math.max(existing.instances, observation.instances);
    existing.classes = unique([...existing.classes, ...observation.classes]);
    existing.pages = unique([...existing.pages, ...observation.pages]);
    existing.states = mergeStates(existing.states, observation.states);
  }

  return [...grouped.values()];
}

function renderCanonicalMeasuredComponent(component: ComponentInfo): string {
  const observations = getMeasuredObservations(component);
  if (observations.length === 0) return '';

  let md = `### ${component.name}\n\n`;
  if (observations.length > 1) {
    md += `> ${observations.length} distinct measured runtime variants were observed for this canonical component. Do not treat any single variant as the universal default.\n\n`;
  }

  observations.forEach((observation, index) => {
    if (observations.length > 1) {
      md += `#### Measured variant ${index + 1}\n\n`;
    }
    if (observation.classes.length > 0) {
      md += `**Observed classes:** ${observation.classes.map(className => `\`.${className}\``).join(' ')}\n\n`;
    }
    if (observation.pages.length > 0) {
      md += `**Observed pages (${observation.pages.length}):** ${observation.pages.map(page => `\`${page}\``).join(', ')}\n\n`;
    }
    md += `**Max instances on one observed page:** ${observation.instances}\n\n`;
    md += `**Measured default style:**\n\n`;
    md += renderMeasuredStyleBlock(observation.style);
    md += `**Observed geometry:** ${observation.style.width} × ${observation.style.height}\n\n`;
    md += renderStates(observation.states);
  });

  return md;
}

function renderMeasuredStyleBlock(style: ComponentStyleSnapshot): string {
  const properties: Array<[string, string, boolean]> = [
    ['background-color', style.backgroundColor, style.backgroundColor !== 'rgba(0, 0, 0, 0)'],
    ['background-image', style.backgroundImage, style.backgroundImage !== 'none'],
    ['color', style.color, true],
    ['border-color', style.borderColor, style.borderWidth !== '0px'],
    ['border-style', style.borderStyle, style.borderWidth !== '0px'],
    ['border-width', style.borderWidth, style.borderWidth !== '0px'],
    ['border-radius', style.borderRadius, style.borderRadius !== '0px'],
    ['padding', style.padding, style.padding !== '0px'],
    ['gap', style.gap, style.gap !== 'normal' && style.gap !== '0px'],
    ['box-shadow', style.boxShadow, style.boxShadow !== 'none'],
    ['text-shadow', style.textShadow, style.textShadow !== 'none'],
    ['opacity', style.opacity, style.opacity !== '1'],
    ['transform', style.transform, style.transform !== 'none'],
    ['filter', style.filter, style.filter !== 'none'],
    ['outline', style.outline, style.outline !== 'none' && !style.outline.startsWith('rgb(0, 0, 0) 0px')],
    ['font-family', style.fontFamily, true],
    ['font-size', style.fontSize, true],
    ['font-weight', style.fontWeight, true],
    ['line-height', style.lineHeight, true],
    ['letter-spacing', style.letterSpacing, style.letterSpacing !== 'normal'],
    ['display', style.display, true],
    ['align-items', style.alignItems, style.alignItems !== 'normal'],
    ['justify-content', style.justifyContent, style.justifyContent !== 'normal'],
    ['cursor', style.cursor, style.cursor !== 'auto'],
    ['transition', style.transition, style.transition !== 'all 0s ease 0s' && style.transition !== 'none'],
  ];

  let css = `\`\`\`css\n`;
  for (const [property, value, include] of properties) {
    if (include && value) css += `${property}: ${value};\n`;
  }
  css += `\`\`\`\n\n`;
  return css;
}

function renderStates(states?: ComponentStateEvidence[]): string {
  if (!states?.length) return '';

  let md = `**Matched interaction states for this measured variant:**\n\n`;
  for (const state of states) {
    const label = state.label ? ` — ${state.label}` : '';
    md += `- **${state.state}${label}**`;
    if (state.screenshot) md += ` — screenshot: \`../${state.screenshot}\``;
    md += `\n`;
    if (state.changes.length > 0) {
      md += `\n  \`\`\`css\n`;
      for (const change of state.changes) {
        md += `  /* ${toCssProperty(change.property)}: ${change.from} → */ ${toCssProperty(change.property)}: ${change.to};\n`;
      }
      md += `  \`\`\`\n`;
    }
  }
  md += `\n`;
  return md;
}

function styleKey(style: ComponentStyleSnapshot): string {
  return Object.keys(style)
    .sort()
    .map(key => `${key}:${style[key as keyof ComponentStyleSnapshot]}`)
    .join('|');
}

function mergeStates(
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

interface TokenSet {
  accent: any;
  bg: any;
  surface: any;
  border: any;
  textPrimary: any;
  commonRadius: string;
  profile: DesignProfile;
}

function buildSuggestedCss(component: DOMComponent, tokens: TokenSet): string {
  const { accent, surface, border, textPrimary, commonRadius, profile } = tokens;
  const spacing = profile.spacing;
  const pad = spacing.base * 2;

  const lines: string[] = [];
  const mainClass = component.commonClasses[0] || component.name.toLowerCase().replace(/\s+/g, '-');
  lines.push(`.${mainClass} {`);

  switch (component.category) {
    case 'card':
    case 'dialog':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${pad}px;`);
      break;

    case 'button':
      if (accent) lines.push(`  background: ${accent.hex};`);
      if (textPrimary) lines.push(`  color: ${textPrimary.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${spacing.base}px ${pad}px;`);
      lines.push(`  cursor: pointer;`);
      break;

    case 'badge':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${Math.round(spacing.base * 0.5)}px ${spacing.base}px;`);
      lines.push(`  font-size: 12px;`);
      break;

    case 'navigation':
    case 'nav-item':
      lines.push(`  padding: ${spacing.base}px ${pad}px;`);
      if (component.category === 'nav-item') lines.push(`  cursor: pointer;`);
      if (accent) lines.push(`  /* active: color: ${accent.hex}; */`);
      break;

    case 'list-item':
      lines.push(`  padding: ${spacing.base}px 0;`);
      if (border) lines.push(`  border-bottom: 1px solid ${border.hex};`);
      break;

    case 'table':
      lines.push(`  width: 100%;`);
      if (border) lines.push(`  border-color: ${border.hex};`);
      break;

    default:
      if (surface) lines.push(`  background: ${surface.hex};`);
      lines.push(`  padding: ${spacing.base}px;`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function inferLegacySource(filePath: string): string {
  if (filePath === 'html') return 'http-dom';
  if (filePath.startsWith('runtime-dom')) return 'runtime-dom';
  return 'source-code';
}

function formatCategory(category: string): string {
  const map: Record<string, string> = {
    navigation: 'Navigation Containers',
    'nav-item': 'Navigation Items',
    button: 'Buttons',
    'form-field': 'Form Fields',
    dialog: 'Dialogs',
    table: 'Tables',
    badge: 'Badges & Chips',
    card: 'Cards',
    'list-item': 'List Items',
    unknown: 'Other Candidates',
  };
  return map[category] || category;
}

function toCssProperty(camelCase: string): string {
  return camelCase.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = key(item);
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
