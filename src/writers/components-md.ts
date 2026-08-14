import { DOMComponent } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/COMPONENTS.md
 *
 * Keeps two evidence layers explicit:
 * - canonical components promoted into DesignProfile
 * - raw repeated DOM candidates emitted by the Ultra structural detector
 */
export function generateComponentsMd(
  domComponents: DOMComponent[],
  profile: DesignProfile
): string {
  let md = `# Component Reference\n\n`;
  md += `> Canonical components are the observations promoted into the normalized design profile.\n`;
  md += `> Raw repeated DOM candidates are structural observations for inspection; they are not automatically canonical components.\n\n`;

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

  // ── Raw repeated-DOM inventory ──────────────────────────────────────
  md += `## Raw Repeated DOM Candidates\n\n`;
  md += `> Structural patterns below appeared 3+ times in the rendered DOM. They remain useful evidence even when the promotion policy rejects them as wrappers, substructures, or low-confidence candidates.\n\n`;

  if (domComponents.length === 0) {
    md += `No repeated DOM candidates detected (Playwright required).\n`;
    return md;
  }

  md += `| Candidate | Detector Category | Instances | Key Classes |\n`;
  md += `|-----------|-------------------|-----------|-------------|\n`;
  for (const c of domComponents) {
    const classes = c.commonClasses.slice(0, 3).map(cl => `\`.${cl}\``).join(', ');
    md += `| **${c.name}** | ${c.category} | ${c.instances}× | ${classes} |\n`;
  }
  md += `\n`;

  // ── Category Groups ─────────────────────────────────────────────────
  const byCategory = groupBy(domComponents, c => c.category);
  const categoryOrder: DOMComponent['category'][] = [
    'card', 'list-item', 'nav-item', 'button', 'badge', 'form-field', 'unknown'
  ];

  const accent = profile.colors.find(c => c.role === 'accent');
  const bg = profile.colors.find(c => c.role === 'background');
  const surface = profile.colors.find(c => c.role === 'surface');
  const border = profile.colors.find(c => c.role === 'border');
  const textPrimary = profile.colors.find(c => c.role === 'text-primary');
  const commonRadius = profile.borderRadius.filter(r => !r.includes('9999'))[
    Math.floor(profile.borderRadius.length / 2)
  ] || '8px';

  for (const category of categoryOrder) {
    const comps = byCategory[category];
    if (!comps?.length) continue;

    md += `## Raw ${formatCategory(category)}\n\n`;

    for (const comp of comps) {
      md += `### ${comp.name}\n\n`;
      md += `**Instances found:** ${comp.instances}\n\n`;

      if (comp.commonClasses.length > 0) {
        md += `**CSS classes:** ${comp.commonClasses.map(c => `\`.${c}\``).join(' ')}\n\n`;
      }

      // HTML snippet
      md += `**HTML structure:**\n\n`;
      md += `\`\`\`html\n`;
      md += `${comp.htmlSnippet}\n`;
      md += `\`\`\`\n\n`;

      // Suggested base CSS from design tokens. This is intentionally labeled
      // as synthesized guidance rather than measured component styling.
      const suggestedCss = buildSuggestedCss(comp, {
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
  md += `- Treat **Raw Repeated DOM Candidates** as structural evidence, not proof that each candidate is a reusable component.\n`;
  md += `- Utility wrappers and unclassified substructures may remain in the raw inventory without being promoted.\n`;
  md += `- Use raw HTML/classes to validate canonical components and screenshot structure; do not promote a raw candidate by assumption.\n`;
  md += `- Token-derived CSS shown for raw candidates is fallback guidance, not measured source styling.\n`;
  if (border) {
    md += `- Extracted border token: \`${border.hex}\`.\n`;
  }
  if (accent) {
    md += `- Extracted accent token: \`${accent.hex}\`.\n`;
  }
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

function buildSuggestedCss(comp: DOMComponent, tokens: TokenSet): string {
  const { accent, surface, border, textPrimary, commonRadius, profile } = tokens;
  const sp = profile.spacing;
  const pad = sp.base * 2;

  const lines: string[] = [];
  const mainClass = comp.commonClasses[0] || comp.name.toLowerCase().replace(/\s+/g, '-');
  lines.push(`.${mainClass} {`);

  switch (comp.category) {
    case 'card':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${pad}px;`);
      break;

    case 'button':
      if (accent) lines.push(`  background: ${accent.hex};`);
      if (textPrimary) lines.push(`  color: ${textPrimary.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${sp.base}px ${pad}px;`);
      lines.push(`  cursor: pointer;`);
      break;

    case 'badge':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${Math.round(sp.base * 0.5)}px ${sp.base}px;`);
      lines.push(`  font-size: 12px;`);
      break;

    case 'nav-item':
      lines.push(`  padding: ${sp.base}px ${pad}px;`);
      lines.push(`  cursor: pointer;`);
      if (accent) lines.push(`  /* active: color: ${accent.hex}; */`);
      break;

    case 'list-item':
      lines.push(`  padding: ${sp.base}px 0;`);
      if (border) lines.push(`  border-bottom: 1px solid ${border.hex};`);
      break;

    default:
      if (surface) lines.push(`  background: ${surface.hex};`);
      lines.push(`  padding: ${sp.base}px;`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function inferLegacySource(filePath: string): string {
  if (filePath === 'html') return 'http-dom';
  if (filePath.startsWith('runtime-dom')) return 'runtime-dom';
  return 'source-code';
}

function formatCategory(cat: string): string {
  const map: Record<string, string> = {
    card: 'Cards',
    'list-item': 'List Items',
    'nav-item': 'Navigation Items',
    button: 'Buttons',
    badge: 'Badges & Chips',
    'form-field': 'Form Fields',
    unknown: 'Other Candidates',
  };
  return map[cat] || cat;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
