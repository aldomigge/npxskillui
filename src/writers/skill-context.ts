import * as fs from 'fs';
import * as path from 'path';
import type { DesignProfile, TypographyRole } from '../types';

export type SkillContextMode = 'full' | 'compact';

export interface SkillContextMetrics {
  lines: number;
  characters: number;
  estimatedTokens: number;
}

const REFERENCE_GUIDANCE: Record<string, string> = {
  'DESIGN.md': 'Exact design tokens, typography roles, spacing, colors, shadows, and craft rules',
  'VISUAL_GUIDE.md': 'Visual reconstruction and screenshot-led composition checks',
  'COMPONENTS.md': 'Detected component structure, measured styles, variants, and runtime provenance',
  'RESPONSIVE.md': 'Sampled viewport evidence and measured responsive structural changes',
  'LAYOUT.md': 'Layout, flex/grid structure, containers, and spacing relationships',
  'INTERACTIONS.md': 'Hover/focus states and measured before/after style differences',
  'ANIMATIONS.md': 'Motion stack, keyframes, scroll behavior, and video/background evidence',
};

const TOKEN_GUIDANCE: Record<string, string> = {
  'colors.json': 'Machine-readable extracted color tokens',
  'spacing.json': 'Machine-readable spacing scale',
  'typography.json': 'Machine-readable typography tokens and roles',
};

const SCREEN_GUIDANCE: Record<string, string> = {
  pages: 'Full-page screenshots for page-level composition',
  responsive: 'Viewport-specific screenshots for responsive implementation',
  sections: 'Section/component clips for local visual matching',
  states: 'Interaction-state screenshots',
  scroll: 'Scroll-journey screenshots for cinematic/motion states',
};

export function parseSkillContextMode(value?: string): SkillContextMode {
  const normalized = (value || 'full').trim().toLowerCase();
  if (normalized === 'full' || normalized === 'compact') return normalized;
  throw new Error(`Unsupported skill context "${value}". Use full or compact.`);
}

/**
 * Replace the generated root SKILL.md with a progressive-disclosure version.
 * Detailed evidence remains untouched in references/, tokens/, and screens/.
 * The caller should run the normal finalizer afterwards so the .skill archive
 * is rebuilt from the compact root document.
 */
export function compactGeneratedSkill(
  profile: DesignProfile,
  skillDir: string
): SkillContextMetrics {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Cannot compact missing skill document: ${skillMdPath}`);
  }

  const content = generateCompactSkillMd(profile, skillDir);
  fs.writeFileSync(skillMdPath, content, 'utf-8');
  return measureSkillContext(content);
}

export function generateCompactSkillMd(profile: DesignProfile, skillDir: string): string {
  const safeName = profile.projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const references = discoverReferenceFiles(skillDir);
  const tokens = discoverTokenFiles(skillDir);
  const screenDirs = discoverScreenDirs(skillDir);
  const referenceSet = new Set(references);
  const tokenSet = new Set(tokens);
  const screenSet = new Set(screenDirs);

  const colors = selectEssentialColors(profile);
  const typography = selectEssentialTypography(profile);
  const components = profile.components.slice(0, 12);
  const breakpoints = profile.breakpoints.slice(0, 8);
  const frameworks = profile.frameworks.map(item => item.version ? `${item.name} ${item.version}` : item.name);
  const radius = profile.borderRadius.find(value => !value.includes('9999')) || profile.borderRadius[0];

  let md = `---\n`;
  md += `name: ${safeName}-design\n`;
  md += `description: Compact design-system skill for ${profile.projectName}. Start here and read only the referenced evidence needed for the current UI task.\n`;
  md += `---\n\n`;

  md += `# ${profile.projectName} Design System\n\n`;
  md += `This is the compact entry point for the extracted design system. Detailed extraction evidence is intentionally kept in separate files so routine UI work does not preload the entire corpus.\n\n`;

  md += `## Context Loading Rules\n\n`;
  md += `1. Start with this file and identify the evidence needed for the current task.\n`;
  md += `2. Read only the relevant files from **Reference Routing** below. Do not preload every reference by default.\n`;
  md += `3. Use screenshots when visual composition matters; inspect only the page, viewport, section, or state relevant to the task.\n`;
  md += `4. Prefer measured/extracted evidence over generated implementation suggestions.\n`;
  md += `5. If evidence conflicts, follow the precedence rules below rather than blending contradictory assumptions.\n\n`;

  md += `## Evidence & Precedence\n\n`;
  md += `1. **Extracted tokens and explicit role mappings** — authoritative for exact values and semantic roles.\n`;
  md += `2. **Screenshots** — authoritative for visual composition, relative emphasis, and appearance in context.\n`;
  md += `3. **Detected components and runtime measurements** — implementation evidence when present.\n`;
  md += `4. **Token-derived recipes or inferred guidance** — fallback only; never override stronger evidence.\n\n`;

  md += `## Essential Snapshot\n\n`;
  if (profile.siteUrl) md += `- Site: \`${profile.siteUrl}\`\n`;
  md += `- Theme: **${profile.designTraits.isDark ? 'dark' : 'light'}**\n`;
  md += `- Density: **${profile.designTraits.density}**\n`;
  md += `- Spacing base: **${profile.spacing.base}${profile.spacing.unit}**\n`;
  if (radius) md += `- Representative radius: **${radius}**\n`;
  md += `- Detected components: **${profile.components.length}**\n`;
  if (frameworks.length) md += `- Frameworks: ${frameworks.join(', ')}\n`;
  md += `\n`;

  if (colors.length > 0) {
    md += `### Essential Colors\n\n`;
    md += `| Role | Value |\n|---|---|\n`;
    for (const color of colors) md += `| ${color.role} | \`${color.hex}\` |\n`;
    const colorDetail = tokenSet.has('colors.json')
      ? '`references/DESIGN.md` or `tokens/colors.json`'
      : '`references/DESIGN.md`';
    md += `\nFor the complete palette and provenance, read ${colorDetail}.\n\n`;
  }

  if (typography.length > 0) {
    md += `### Essential Typography\n\n`;
    md += `| Role | Family | Size | Weight |\n|---|---|---|---|\n`;
    for (const token of typography) {
      md += `| ${token.role} | ${token.fontFamily} | ${token.fontSize || '—'} | ${token.fontWeight ?? '—'} |\n`;
    }
    const typeDetail = tokenSet.has('typography.json')
      ? '`references/DESIGN.md` or `tokens/typography.json`'
      : '`references/DESIGN.md`';
    md += `\nFor the full type scale and source evidence, read ${typeDetail}.\n\n`;
  }

  if (components.length > 0) {
    md += `### Detected Component Index\n\n`;
    for (const component of components) {
      const confidence = typeof component.confidence === 'number'
        ? `, ${Math.round(component.confidence * 100)}% confidence`
        : '';
      md += `- **${component.name}** — ${component.category}${confidence}\n`;
    }
    if (profile.components.length > components.length) {
      md += `- …and ${profile.components.length - components.length} more detected component record(s)\n`;
    }
    const componentDetail = referenceSet.has('COMPONENTS.md')
      ? '`references/COMPONENTS.md`'
      : '`references/DESIGN.md`';
    md += `\nRead ${componentDetail} before implementing or modifying extracted components.\n\n`;
  }

  if (breakpoints.length > 0) {
    md += `### Declared Breakpoints\n\n`;
    for (const breakpoint of breakpoints) {
      md += `- **${breakpoint.name}:** \`${breakpoint.value}\` (${breakpoint.source})\n`;
    }
    if (referenceSet.has('RESPONSIVE.md')) {
      md += `\nDeclared breakpoints are static CSS evidence. Use \`references/RESPONSIVE.md\` for measured viewport behavior without treating sampled widths as exact breakpoint proof.\n\n`;
    } else {
      md += `\nThese are declared static breakpoints. No measured responsive reference was generated for this run.\n\n`;
    }
  }

  md += `## Reference Routing\n\n`;
  md += `Read a reference only when the task needs that evidence.\n\n`;
  if (references.length > 0) {
    md += `| Reference | Read when you need… |\n|---|---|\n`;
    for (const file of references) {
      md += `| \`references/${file}\` | ${REFERENCE_GUIDANCE[file] || 'Detailed extraction evidence'} |\n`;
    }
    md += `\n`;
  } else {
    md += `No standalone reference files were generated for this run.\n\n`;
  }

  if (tokens.length > 0) {
    md += `### Machine-Readable Tokens\n\n`;
    md += `| File | Purpose |\n|---|---|\n`;
    for (const file of tokens) {
      md += `| \`tokens/${file}\` | ${TOKEN_GUIDANCE[file] || 'Extracted token data'} |\n`;
    }
    md += `\n`;
  }

  if (screenDirs.length > 0) {
    md += `### Screenshot Routing\n\n`;
    md += `| Directory | Inspect when you need… |\n|---|---|\n`;
    for (const dir of screenDirs) {
      md += `| \`screens/${dir}/\` | ${SCREEN_GUIDANCE[dir] || 'Visual evidence'} |\n`;
    }
    if (fs.existsSync(path.join(skillDir, 'screens', 'INDEX.md'))) {
      md += `| \`screens/INDEX.md\` | Screenshot inventory and page/section lookup |\n`;
    }
    md += `\n`;
  }

  const homepageDir = path.join(skillDir, 'screenshots');
  if (hasImages(homepageDir)) {
    md += `- Legacy/homepage captures are available under \`screenshots/\`.\n\n`;
  }

  md += `## Task Routing Examples\n\n`;
  const componentRoute = referenceSet.has('COMPONENTS.md')
    ? '`references/COMPONENTS.md`'
    : '`references/DESIGN.md`';
  md += `- **Build or restyle a component:** read ${componentRoute}, then exact token evidence as needed.\n`;

  const pageRefs = ['VISUAL_GUIDE.md', 'LAYOUT.md']
    .filter(file => referenceSet.has(file))
    .map(file => `\`references/${file}\``);
  if (pageRefs.length > 0 || screenSet.has('pages')) {
    const pageParts = [...pageRefs];
    if (screenSet.has('pages')) pageParts.push('the matching `screens/pages/` capture');
    md += `- **Recreate a page:** use ${pageParts.join(' and ')}.\n`;
  }

  if (referenceSet.has('RESPONSIVE.md') || screenSet.has('responsive')) {
    const responsiveParts: string[] = [];
    if (referenceSet.has('RESPONSIVE.md')) responsiveParts.push('`references/RESPONSIVE.md`');
    if (screenSet.has('responsive')) responsiveParts.push('the matching `screens/responsive/` samples');
    md += `- **Implement responsive behavior:** use ${responsiveParts.join(' and ')}.\n`;
  }

  if (referenceSet.has('INTERACTIONS.md') || screenSet.has('states')) {
    const interactionParts: string[] = [];
    if (referenceSet.has('INTERACTIONS.md')) interactionParts.push('`references/INTERACTIONS.md`');
    if (screenSet.has('states')) interactionParts.push('matching `screens/states/` captures');
    md += `- **Implement hover/focus behavior:** use ${interactionParts.join(' and ')}.\n`;
  }

  if (referenceSet.has('ANIMATIONS.md') || screenSet.has('scroll')) {
    const motionParts: string[] = [];
    if (referenceSet.has('ANIMATIONS.md')) motionParts.push('`references/ANIMATIONS.md`');
    if (screenSet.has('scroll')) motionParts.push('relevant `screens/scroll/` evidence');
    md += `- **Reproduce motion:** use ${motionParts.join(' and ')}.\n`;
  }

  const exactTokenRoutes: string[] = [];
  if (tokenSet.has('colors.json')) exactTokenRoutes.push('`tokens/colors.json`');
  if (tokenSet.has('spacing.json')) exactTokenRoutes.push('`tokens/spacing.json`');
  if (tokenSet.has('typography.json')) exactTokenRoutes.push('`tokens/typography.json`');
  if (exactTokenRoutes.length > 0) {
    md += `- **Need only exact colors/type/spacing:** prefer ${exactTokenRoutes.join(', ')} as applicable; use \`references/DESIGN.md\` for semantic context.\n\n`;
  } else {
    md += `- **Need only exact colors/type/spacing:** read \`references/DESIGN.md\`; no standalone token JSON was generated for this run.\n\n`;
  }

  md += `## Workflow\n\n`;
  md += `1. Identify the UI surface and evidence category required by the request.\n`;
  md += `2. Load the smallest relevant reference set.\n`;
  md += `3. Implement from extracted/measured evidence.\n`;
  md += `4. Compare against the relevant screenshots when visual fidelity matters.\n`;
  md += `5. Preserve uncertainty where evidence is incomplete instead of inventing source behavior.\n`;

  return md;
}

export function measureSkillContext(content: string): SkillContextMetrics {
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  const characters = content.length;
  return {
    lines,
    characters,
    // Useful coarse telemetry only; not a model-specific tokenizer count.
    estimatedTokens: Math.ceil(characters / 4),
  };
}

function discoverReferenceFiles(skillDir: string): string[] {
  const refsDir = path.join(skillDir, 'references');
  if (!fs.existsSync(refsDir)) return [];
  const preferredOrder = [
    'DESIGN.md',
    'VISUAL_GUIDE.md',
    'COMPONENTS.md',
    'RESPONSIVE.md',
    'LAYOUT.md',
    'INTERACTIONS.md',
    'ANIMATIONS.md',
  ];
  const existing = new Set(
    fs.readdirSync(refsDir).filter(file => file.toLowerCase().endsWith('.md'))
  );
  const ordered = preferredOrder.filter(file => existing.delete(file));
  return [...ordered, ...[...existing].sort()];
}

function discoverTokenFiles(skillDir: string): string[] {
  const tokensDir = path.join(skillDir, 'tokens');
  if (!fs.existsSync(tokensDir)) return [];
  const preferredOrder = ['colors.json', 'spacing.json', 'typography.json'];
  const existing = new Set(
    fs.readdirSync(tokensDir).filter(file => file.toLowerCase().endsWith('.json'))
  );
  const ordered = preferredOrder.filter(file => existing.delete(file));
  return [...ordered, ...[...existing].sort()];
}

function discoverScreenDirs(skillDir: string): string[] {
  const screensDir = path.join(skillDir, 'screens');
  if (!fs.existsSync(screensDir)) return [];
  const preferredOrder = ['pages', 'responsive', 'sections', 'states', 'scroll'];
  return preferredOrder.filter(dir => hasImages(path.join(screensDir, dir)));
}

function hasImages(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
}

function selectEssentialColors(profile: DesignProfile) {
  const preferred = [
    'background',
    'surface',
    'text-primary',
    'text-muted',
    'border',
    'accent',
    'success',
    'warning',
    'danger',
    'info',
  ] as const;

  return preferred
    .map(role => profile.colors.find(color => color.role === role))
    .filter((color): color is NonNullable<typeof color> => !!color);
}

function selectEssentialTypography(profile: DesignProfile) {
  const preferred: TypographyRole[] = [
    'heading-1',
    'heading-2',
    'heading-3',
    'body',
    'caption',
    'code',
  ];

  return preferred
    .map(role => profile.typography.find(token => token.role === role))
    .filter((token): token is NonNullable<typeof token> => !!token);
}
