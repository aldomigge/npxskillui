import { rewriteResponsiveEmbeddedPaths } from '../writers/responsive-skill';

function main(): void {
  let passed = 0;

  expectEqual(
    rewriteResponsiveEmbeddedPaths('![mobile](../screens/responsive/home--390x844.png)'),
    '![mobile](screens/responsive/home--390x844.png)',
    'embedded responsive image path should become root-relative'
  ); passed++;

  expectEqual(
    rewriteResponsiveEmbeddedPaths('[screenshot](../screens/responsive/news--1440x900.png)'),
    '[screenshot](screens/responsive/news--1440x900.png)',
    'ordinary Markdown links should also become root-relative'
  ); passed++;

  expectEqual(
    rewriteResponsiveEmbeddedPaths('![mobile](screens/responsive/home--390x844.png)'),
    '![mobile](screens/responsive/home--390x844.png)',
    'already-correct root-relative paths should remain unchanged'
  ); passed++;

  expectEqual(
    rewriteResponsiveEmbeddedPaths('Literal example: `../screens/responsive/home--390x844.png`'),
    'Literal example: `../screens/responsive/home--390x844.png`',
    'literal prose/examples should not be rewritten'
  ); passed++;

  console.log('Responsive skill packaging benchmark');
  console.log(`  embedded path cases: ${passed}/4`);
  console.log('  status:              PASS');
}

function expectEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${expected}, got ${actual}`);
  }
}

main();
