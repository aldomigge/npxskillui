import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import type { DesignProfile } from '../types';

export interface GeneratedSkillResult {
  skillDir: string;
  skillFile: string;
}

interface TypographyUsage {
  bodyFont?: string;
  headingFont?: string;
  hasBodyEvidence: boolean;
  hasHeadingEvidence: boolean;
}

/**
 * Normalize generated design documentation after the legacy writers run.
 *
 * This keeps extraction/generation backward compatible while making the final
 * skill explicit about what was extracted versus what was synthesized from
 * tokens. The .skill archive is rebuilt so folder and package stay identical.
 */
export async function finalizeGeneratedSkill(
  profile: DesignProfile,
  result: GeneratedSkillResult
): Promise<GeneratedSkillResult> {
  const skillMdPath = path.join(result.skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return result;

  const typography = deriveTypographyUsage(profile);
  normalizeStandaloneDesignFiles(result.skillDir, typography, profile.components.length);

  let content = fs.readFileSync(skillMdPath, 'utf-8');
  content = makeAgentNeutral(content);
  content = addEvidencePrecedence(content);
  content = normalizeTypography(content, typography);
  content = normalizeDesignMdGuidance(content, typography, profile.components.length);
  content = normalizeComponentGuidance(content, profile.components.length);
  content = normalizeWorkflow(content);
  content = normalizeQuickReference(content, profile.components.length, typography);

  fs.writeFileSync(skillMdPath, content, 'utf-8');
  await rebuildSkillArchive(result.skillDir, result.skillFile);

  return result;
}

function normalizeStandaloneDesignFiles(
  skillDir: string,
  usage: TypographyUsage,
  detectedCount: number
): void {
  const files = [
    path.join(skillDir, 'DESIGN.md'),
    path.join(skillDir, 'references', 'DESIGN.md'),
  ];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, normalizeDesignMdGuidance(content, usage, detectedCount), 'utf-8');
  }
}

function makeAgentNeutral(content: string): string {
  return content
    .replace(
      '> Every output file is embedded below. Claude has full design system context from /skills alone.',
      '> Every output file is embedded below so the active coding agent has the full design-system context from this skill.'
    )
    .replace(
      'Provides exact color tokens, typography scale, spacing grid, component patterns, and craft rules.',
      'Provides exact color tokens, typography scale, spacing grid, component guidance, and craft rules.'
    );
}

function addEvidencePrecedence(content: string): string {
  if (content.includes('## Evidence & Precedence')) return content;

  const section = `## Evidence & Precedence\n\n` +
    `Use the following hierarchy when interpreting this skill:\n\n` +
    `1. **Extracted tokens and explicit role mappings** — authoritative for exact values and semantic roles.\n` +
    `2. **Screenshots** — authoritative for visual composition, relative emphasis, and how tokens appear in context.\n` +
    `3. **Detected components** — implementation evidence from source/DOM extraction when present.\n` +
    `4. **Token-derived recipes** — fallback implementation guidance synthesized by SkillUI; these are not proof that the source contains those components.\n\n` +
    `If two sources appear to conflict, do not combine contradictory assumptions. Prefer the higher-evidence source above and preserve the ambiguity when evidence is incomplete.\n\n`;

  const marker = content.includes('## Visual Reference') ? '## Visual Reference' : '## Design Philosophy';
  return content.replace(marker, `${section}${marker}`);
}

function deriveTypographyUsage(profile: DesignProfile): TypographyUsage {
  const isMono = (font: string) => /mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(font);
  const displayTokens = profile.typography.filter(t => t.fontFamily && !isMono(t.fontFamily));

  const pickDominant = (roles: Set<string>): string | undefined => {
    const counts = new Map<string, number>();
    for (const token of displayTokens) {
      if (!roles.has(token.role)) continue;
      counts.set(token.fontFamily, (counts.get(token.fontFamily) || 0) + 1);
    }

    let best: string | undefined;
    let bestCount = -1;
    for (const token of displayTokens) {
      const count = counts.get(token.fontFamily) || 0;
      if (count > bestCount) {
        best = token.fontFamily;
        bestCount = count;
      }
    }
    return bestCount > 0 ? best : undefined;
  };

  const bodyRoles = new Set(['body', 'caption']);
  const headingRoles = new Set(['heading-1', 'heading-2', 'heading-3', 'heading-4']);
  const bodyFromRoles = pickDominant(bodyRoles);
  const headingFromRoles = pickDominant(headingRoles);

  const fallbackCounts = new Map<string, number>();
  for (const token of displayTokens) {
    fallbackCounts.set(token.fontFamily, (fallbackCounts.get(token.fontFamily) || 0) + 1);
  }
  const fallbackFont = [...fallbackCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    bodyFont: bodyFromRoles || fallbackFont,
    headingFont: headingFromRoles || bodyFromRoles || fallbackFont,
    hasBodyEvidence: !!bodyFromRoles,
    hasHeadingEvidence: !!headingFromRoles,
  };
}

function normalizeTypography(content: string, usage: TypographyUsage): string {
  const roleRule = typographyRoleRule(usage);

  content = content.replace(/^- \*\*Type pairing\*\* — .*$/m, roleRule);
  content = content.replace(/^- \*\*Single typeface\*\* — .*$/m, roleRule);
  content = content.replace(/^- Body\/UI: .*$/m, roleRule);
  content = content.replace(/^- All text uses \*\*.*$/m, roleRule);

  if (usage.bodyFont || usage.headingFont) {
    const brandLines: string[] = [];
    if (usage.bodyFont) brandLines.push(`- **Body typeface:** ${usage.bodyFont}`);
    if (usage.headingFont && usage.headingFont !== usage.bodyFont) {
      brandLines.push(`- **Heading typeface:** ${usage.headingFont}`);
    }
    content = content.replace(/^- \*\*Brand typeface:\*\* .*$/m, brandLines.join('\n'));
  }

  return content;
}

function typographyRoleRule(usage: TypographyUsage): string {
  if (usage.bodyFont && usage.headingFont && usage.bodyFont !== usage.headingFont && usage.hasBodyEvidence && usage.hasHeadingEvidence) {
    return `- **Extracted type roles** — body/caption: **${usage.bodyFont}**; headings: **${usage.headingFont}**. This mapping comes from extracted typography roles and overrides font-order assumptions.`;
  }

  if (usage.bodyFont && usage.headingFont && usage.bodyFont === usage.headingFont && (usage.hasBodyEvidence || usage.hasHeadingEvidence)) {
    return `- **Extracted type roles** — **${usage.bodyFont}** is used across the extracted body/heading roles. Follow the Type Scale table for exact role, size, and weight assignments.`;
  }

  return '- **Typography role safety** — follow the extracted Type Scale table. Do not infer heading/body purpose from font discovery order when explicit role evidence is missing.';
}

function typographySummarySentence(usage: TypographyUsage): string {
  if (usage.bodyFont && usage.headingFont && usage.bodyFont !== usage.headingFont && usage.hasBodyEvidence && usage.hasHeadingEvidence) {
    return `Typography uses **${usage.headingFont}** for extracted heading roles and **${usage.bodyFont}** for extracted body/caption roles. Role assignments come from the extracted type scale, not font discovery order.`;
  }

  if (usage.bodyFont && usage.headingFont && usage.bodyFont === usage.headingFont && (usage.hasBodyEvidence || usage.hasHeadingEvidence)) {
    return `Typography uses **${usage.bodyFont}** across the extracted body and heading roles; hierarchy comes from the extracted sizes and weights.`;
  }

  return 'Typography roles must follow the extracted type-scale table; font purpose must not be inferred from discovery order.';
}

function normalizeDesignMdGuidance(
  content: string,
  usage: TypographyUsage,
  detectedCount: number
): string {
  const roleRule = typographyRoleRule(usage);
  const summary = typographySummarySentence(usage);

  content = content.replace(
    /Typography pairs \*\*[^*]+\*\* for display\/headings with \*\*[^*]+\*\* for body text, creating clear visual hierarchy through type contrast\./g,
    summary
  );

  content = content.replace(
    /^- Use \*\*[^*]+\*\* for body\/UI text, \*\*[^*]+\*\* for display\/headings$/gm,
    roleRule
  );

  content = content.replace(
    /^- Pair \*\*[^*]+\*\* \(body\) with \*\*[^*]+\*\* \(display\) — these are the only allowed fonts$/gm,
    roleRule
  );

  if (usage.bodyFont) {
    content = content.replace(/^Font:\s+.*$/gm, `Font: ${usage.bodyFont}`);
  }

  const agentGuideIntro = detectedCount === 0
    ? 'No components were confidently detected. The examples below are token-derived implementation starting points, not extracted component evidence. Validate them against screenshots and tokens before use.'
    : `The examples below are token-derived implementation starting points. ${detectedCount} component records were detected separately; prefer extracted component evidence when it exists.`;

  content = content.replace(
    /## 10\. Agent Prompt Guide\n\nUse these as starting points when building new UI:\n\n/g,
    `## 10. Token-Derived Agent Prompt Guide\n\n${agentGuideIntro}\n\n`
  );

  return content;
}

function normalizeComponentGuidance(content: string, detectedCount: number): string {
  if (!content.includes('## Component Patterns')) return content;

  const evidenceNote = detectedCount === 0
    ? '- **No components were confidently detected.** The recipes below are synthesized from extracted design tokens and must not be described as source components.\n'
    : `- **Detected component records:** ${detectedCount}. Extracted component evidence is distinct from the generated recipes below.\n`;

  const replacement = `## Component Guidance\n\n` +
    `### Evidence Status\n\n` +
    evidenceNote +
    `- **Token-derived recipes:** Card, Button, Input, Badge/Chip, Modal/Dialog, Table, and Navigation.\n` +
    `- Recipes are implementation starting points only. Validate them against screenshots and extracted component evidence before treating them as canonical.\n` +
    `- A generated recipe must never override extracted colors, typography roles, spacing, screenshots, or detected component structure.\n\n` +
    `### Token-Derived Implementation Recipes\n\n`;

  return content
    .replace('## Component Patterns\n\n', replacement)
    .replace('### Extracted Components\n\n', '### Detected Components (Extraction Evidence)\n\n');
}

function normalizeWorkflow(content: string): string {
  return content.replace(
    '5. **Match components** to patterns above before creating new ones',
    '5. **Use component evidence carefully** — prefer detected components when available; otherwise use token-derived recipes only as a starting point and validate against screenshots'
  );
}

function normalizeQuickReference(
  content: string,
  detectedCount: number,
  usage: TypographyUsage
): string {
  let fontLines = '';
  if (usage.bodyFont && usage.headingFont && usage.bodyFont !== usage.headingFont) {
    fontLines = `Body font:      ${usage.bodyFont}\nHeading font:   ${usage.headingFont}`;
  } else if (usage.bodyFont || usage.headingFont) {
    fontLines = `Font:           ${usage.bodyFont || usage.headingFont}`;
  }

  if (fontLines) {
    content = content.replace(/^Font:\s+.*$/m, fontLines);
  }

  content = content.replace(
    /^Components:\s+\d+ detected$/m,
    `Detected comps: ${detectedCount}\nRecipes:        token-derived fallbacks`
  );

  return content;
}

async function rebuildSkillArchive(skillDir: string, skillFile: string): Promise<void> {
  if (fs.existsSync(skillFile)) fs.unlinkSync(skillFile);

  const parentDir = path.dirname(skillDir);
  const tempFile = path.join(parentDir, `.${path.basename(skillDir)}-${process.pid}.skill.tmp`);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tempFile);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(skillDir, path.basename(skillDir));
    archive.finalize();
  });

  fs.renameSync(tempFile, skillFile);
}
