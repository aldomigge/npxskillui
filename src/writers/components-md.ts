import { DOMComponent } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/COMPONENTS.md
 *
 * Keeps two evidence layers explicit:
 * - canonical components promoted into DesignProfile
 * - raw runtime DOM candidates emitted by the detector
 */
export function generateComponentsMd(
  domComponents: DOMComponent[],
  profile: DesignProfile
): string {
  let md = `# Component Reference\n\n`;
  md += `> Canonical components are observations promoted into the normalized design profile.\n`;
  md += `> Raw runtime DOM candidates are detector observations for inspection; they are not automatically canonical components.\n\n`;

  // ── Canonical inventory ─────────────────────────────────────────────
  md += `## Canonical Components\n\n`;

  if (profile.components.length === 0) {
    md += `No component observations were promoted into the canonical design profile.\n\n`;
  } else {
    md += `These are the component records that downstream DESIGN.md / SKILL.md guidance may treat as extracted component evidence.\n\n`;
    md += `| Component | Category | Confidence | Instances | Evidence Sources |\n`;
    md += `|-----------|----------|------------|-----------|------------------|\n`;

    for (const component of profile.components) {
      const confidence = component.confidence != null
        ? `${Math.round(component.confidence * 100)}%`
        : 'n/a';
      const instances = component.instances != null ? `${component.instances}×` : 'n/a';
      const sources = component.evidence?.length
        ? [...new Set(component.evidence.map(e => e.source))].join(', ')
        : inferLegacySource(component.filePath);

      md += `| **${component.name}** | ${component.category} | ${confidence} | ${instances} | ${sources} |\n`;
    }
    md += `\n`;
  }

  // ── Raw runtime-DOM inventory ───────────────────────────────────────
  md += `## Raw Runtime DOM Candidates\n\n`;
  md += `> High-confidence semantic HTML/ARIA observations may appear once. Structural/class-only candidates require repetition. Raw candidates remain evidence even when the promotion policy rejects them.\n\n`;

  if (domComponents.length === 0) {
    md += `No runtime DOM candidates detected (Playwright required).\n`;
    return md;
  }

  md += `| Candidate | Detector Category | Confidence | Instances | Semantic | Key Classes |\n`;
  md += `|-----------|-------------------|------------|-----------|----------|-------------|\n`;
  for (const component of domComponents) {
    const classes = component.commonClasses.slice(0, 3).map(className => `\`.${className}\``).join(', ');
    const confidence = component.confidence != null ? `${Math.round(component.confidence * 100)}%` : 'n/a';
    const semantic = [component.tag ? `<${component.tag}>` : '', component.role ? `role=${component.role}` : '']
      .filter(Boolean)
      .join(' / ') || 'class/structure';
    md += `| **${component.name}** | ${component.category} | ${confidence} | ${component.instances}× | ${semantic} | ${classes} |\n`;
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
      md += `**Instances found:** ${component.instances}\n\n`;
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

      const suggestedCss = buildSuggestedCss(component, {
        accent, bg, surface, border, textPrimary, commonRadius, profile
      });
      if (suggestedCss) {
        md += `**Token-derived implementation starting point (not measured component styles):**\n\n`;
        md += `\`\`\`css\n`;
        md += suggestedCss;
        md += `\`\`\`\n\n`;
      }
    }
  }

  // ── Evidence Rules ──────────────────────────────────────────────────
  md += `## Component Evidence Rules\n\n`;
  md += `- Treat the **Canonical Components** table as the normalized component inventory.\n`;
  md += `- Treat **Raw Runtime DOM Candidates** as detector evidence, not proof that every candidate is a reusable component.\n`;
  md += `- Native HTML and explicit ARIA semantics outrank class-name guesses.\n`;
  md += `- Utility wrappers and unclassified substructures may remain in the raw inventory without being promoted.\n`;
  md += `- Use raw HTML/classes to validate canonical components and screenshot structure; do not promote a raw candidate by assumption.\n`;
  md += `- Token-derived CSS shown for raw candidates is fallback guidance, not measured source styling.\n`;
  if (border) md += `- Extracted border token: \`${border.hex}\`.\n`;
  if (accent) md += `- Extracted accent token: \`${accent.hex}\`.\n`;
  md += `\n`;

  return md;
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

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = key(item);
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
