import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesignProfile } from '../types';
import {
  compactGeneratedSkill,
  generateCompactSkillMd,
  measureSkillContext,
  parseSkillContextMode,
} from '../writers/skill-context';

function main(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillui-context-'));
  const skillDir = path.join(tempRoot, 'fixture-design');

  try {
    prepareFixture(skillDir);
    const profile = fixtureProfile();

    let parsingPassed = 0;
    expectEqual(parseSkillContextMode(), 'full', 'default mode must preserve legacy full context'); parsingPassed++;
    expectEqual(parseSkillContextMode('full'), 'full', 'full should parse'); parsingPassed++;
    expectEqual(parseSkillContextMode(' COMPACT '), 'compact', 'compact parsing should be normalized'); parsingPassed++;
    expectThrows(() => parseSkillContextMode('tiny'), 'invalid mode should be rejected'); parsingPassed++;

    const designBefore = fs.readFileSync(path.join(skillDir, 'references', 'DESIGN.md'), 'utf-8');
    const responsiveBefore = fs.readFileSync(path.join(skillDir, 'references', 'RESPONSIVE.md'), 'utf-8');
    const compact = generateCompactSkillMd(profile, skillDir);
    const metrics = measureSkillContext(compact);

    let routingPassed = 0;
    expect(compact.includes('`references/DESIGN.md`'), 'compact root should route to DESIGN.md'); routingPassed++;
    expect(compact.includes('`references/COMPONENTS.md`'), 'compact root should route to COMPONENTS.md'); routingPassed++;
    expect(compact.includes('`references/RESPONSIVE.md`'), 'compact root should route to RESPONSIVE.md'); routingPassed++;
    expect(compact.includes('`screens/responsive/`'), 'compact root should route to responsive screenshots'); routingPassed++;
    expect(compact.includes('`tokens/colors.json`'), 'compact root should route to token JSON'); routingPassed++;
    expect(!compact.includes('REFERENCE-FILLER-LINE-199'), 'reference bodies must not be embedded in compact root'); routingPassed++;
    expect(!compact.includes('# Full Reference Files'), 'legacy full-reference embedding marker must be absent'); routingPassed++;
    expect(compact.includes('| accent | `#ff3f3f` |'), 'essential extracted colors should remain immediately available'); routingPassed++;
    expect(compact.includes('| body | Circe | 16px | 400 |'), 'essential typography roles should remain immediately available'); routingPassed++;

    let budgetPassed = 0;
    expect(metrics.lines <= 500, `compact root should stay within 500 lines, got ${metrics.lines}`); budgetPassed++;
    expect(metrics.characters < 20_000, `compact fixture should remain concise, got ${metrics.characters} chars`); budgetPassed++;

    const writeMetrics = compactGeneratedSkill(profile, skillDir);
    const written = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');

    let preservationPassed = 0;
    expectEqual(written, compact, 'writer output should match pure compact generator'); preservationPassed++;
    expectEqual(writeMetrics.lines, metrics.lines, 'writer metrics should match pure measurement'); preservationPassed++;
    expectEqual(fs.readFileSync(path.join(skillDir, 'references', 'DESIGN.md'), 'utf-8'), designBefore, 'DESIGN.md must remain untouched'); preservationPassed++;
    expectEqual(fs.readFileSync(path.join(skillDir, 'references', 'RESPONSIVE.md'), 'utf-8'), responsiveBefore, 'RESPONSIVE.md must remain untouched'); preservationPassed++;

    console.log('Skill context benchmark');
    console.log(`  parsing cases:          ${parsingPassed}/4`);
    console.log(`  routing cases:          ${routingPassed}/9`);
    console.log(`  compact budget cases:   ${budgetPassed}/2`);
    console.log(`  preservation cases:     ${preservationPassed}/4`);
    console.log(`  compact lines:          ${metrics.lines}`);
    console.log(`  compact characters:     ${metrics.characters}`);
    console.log(`  estimated tokens:       ~${metrics.estimatedTokens}`);
    console.log('  status:                 PASS');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function prepareFixture(skillDir: string): void {
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'tokens'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'responsive'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'pages'), { recursive: true });

  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    Array.from({ length: 800 }, (_, index) => `legacy-root-line-${index}`).join('\n'),
    'utf-8'
  );

  const largeReference = Array.from(
    { length: 200 },
    (_, index) => `REFERENCE-FILLER-LINE-${index}`
  ).join('\n');

  fs.writeFileSync(path.join(skillDir, 'references', 'DESIGN.md'), `# Design\n${largeReference}\n`, 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'references', 'COMPONENTS.md'), `# Components\n${largeReference}\n`, 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'references', 'RESPONSIVE.md'), `# Responsive\n${largeReference}\n`, 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'references', 'ANIMATIONS.md'), `# Animations\n${largeReference}\n`, 'utf-8');

  fs.writeFileSync(path.join(skillDir, 'tokens', 'colors.json'), '{"accent":"#ff3f3f"}\n', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'tokens', 'spacing.json'), '{"base":4}\n', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'tokens', 'typography.json'), '{"body":"Circe"}\n', 'utf-8');

  fs.writeFileSync(path.join(skillDir, 'screens', 'responsive', 'home--390x844.png'), Buffer.from([0]));
  fs.writeFileSync(path.join(skillDir, 'screens', 'pages', 'home.png'), Buffer.from([0]));
  fs.writeFileSync(path.join(skillDir, 'screens', 'INDEX.md'), '# Screens\n', 'utf-8');
}

function fixtureProfile(): DesignProfile {
  return {
    projectName: 'Fixture',
    siteUrl: 'https://fixture.local',
    colors: [
      { role: 'background', hex: '#ffffff', frequency: 100, source: 'computed' },
      { role: 'surface', hex: '#ced4d9', frequency: 80, source: 'computed' },
      { role: 'text-primary', hex: '#222222', frequency: 70, source: 'computed' },
      { role: 'accent', hex: '#ff3f3f', frequency: 60, source: 'computed' },
    ],
    typography: [
      { role: 'heading-1', fontFamily: 'Montserrat', fontSize: '48px', fontWeight: 700, source: 'computed' },
      { role: 'body', fontFamily: 'Circe', fontSize: '16px', fontWeight: 400, source: 'computed' },
      { role: 'caption', fontFamily: 'Circe', fontSize: '12px', fontWeight: 400, source: 'computed' },
    ],
    spacing: { base: 4, unit: 'px', values: [4, 8, 12, 16, 24, 32] },
    borderRadius: ['4px', '8px'],
    components: [
      {
        name: 'Header Navigation Item',
        filePath: '',
        variants: [],
        cssClasses: [],
        jsxSnippet: '',
        props: [],
        category: 'navigation',
        hasAnimation: false,
        animationDetails: [],
        statePatterns: [],
        tailwindPatterns: {
          backgrounds: [], borders: [], spacing: [], typography: [], effects: [], layout: [], interactive: [],
        },
        confidence: 0.96,
      },
    ],
    breakpoints: [
      { name: 'md', value: '768px', source: 'css' },
      { name: 'xl', value: '1440px', source: 'css' },
    ],
    frameworks: [],
    designTraits: {
      isDark: false,
      hasShadows: false,
      hasGradients: false,
      hasRoundedFull: false,
      maxBorderRadius: 8,
      primaryColorTemp: 'neutral',
      fontStyle: 'sans-serif',
      density: 'standard',
      hasAnimations: true,
      hasDarkMode: false,
      motionStyle: 'expressive',
    },
  } as unknown as DesignProfile;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Benchmark failed: ${message}`);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectThrows(fn: () => unknown, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Benchmark failed: ${message}`);
}

main();
