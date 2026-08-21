import * as fs from 'fs';
import * as path from 'path';

/**
 * Inject responsive runtime evidence into the generated SKILL.md before the
 * finalizer rebuilds the .skill archive.
 *
 * This is intentionally conditional: legacy/default runs that do not produce
 * references/RESPONSIVE.md remain byte-for-byte unaffected by this helper.
 */
export function embedResponsiveEvidenceInSkill(skillDir: string): void {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const responsiveMdPath = path.join(skillDir, 'references', 'RESPONSIVE.md');

  if (!fs.existsSync(skillMdPath) || !fs.existsSync(responsiveMdPath)) return;

  let skillMd = fs.readFileSync(skillMdPath, 'utf-8');
  if (skillMd.includes('## Responsive Runtime Evidence (RESPONSIVE.md)')) return;

  const responsiveMd = rewriteResponsiveEmbeddedPaths(
    fs.readFileSync(responsiveMdPath, 'utf-8').trim()
  );
  if (!responsiveMd) return;

  skillMd = addResponsiveReferenceRow(skillMd);
  skillMd += `\n\n## Responsive Runtime Evidence (RESPONSIVE.md)\n\n${responsiveMd}\n`;

  const responsiveScreensDir = path.join(skillDir, 'screens', 'responsive');
  if (fs.existsSync(responsiveScreensDir)) {
    const images = fs.readdirSync(responsiveScreensDir)
      .filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file))
      .sort();

    if (images.length > 0) {
      skillMd += `\n### Responsive Screenshots (screens/responsive/)\n\n`;
      skillMd += `These are measured viewport samples, not inferred exact breakpoint thresholds.\n\n`;
      for (const image of images) {
        skillMd += `![${image}](screens/responsive/${image})\n\n`;
      }
    }
  }

  fs.writeFileSync(skillMdPath, skillMd, 'utf-8');
}

/**
 * RESPONSIVE.md lives under references/, so its Markdown images point one
 * directory up (`../screens/...`). Once that document is embedded into the
 * root SKILL.md, those links must become root-relative (`screens/...`).
 *
 * Only Markdown link/image destinations are rewritten. Literal examples or
 * prose containing `../screens/` remain untouched.
 */
export function rewriteResponsiveEmbeddedPaths(content: string): string {
  return content.replace(/(\]\()\.\.\/screens\//g, '$1screens/');
}

function addResponsiveReferenceRow(content: string): string {
  if (content.includes('`references/RESPONSIVE.md`')) return content;

  const row = '| `references/RESPONSIVE.md` | Sampled viewport evidence, structural responsive changes, and overflow telemetry |\n';
  const componentRow = '| `references/COMPONENTS.md` | DOM component patterns, HTML structure, class fingerprints |\n';
  const interactionRow = '| `references/INTERACTIONS.md` | Hover/focus states with before/after style diffs |\n';

  if (content.includes(componentRow)) {
    return content.replace(componentRow, `${componentRow}${row}`);
  }

  if (content.includes(interactionRow)) {
    return content.replace(interactionRow, `${row}${interactionRow}`);
  }

  return content;
}
