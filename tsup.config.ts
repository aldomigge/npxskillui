import { defineConfig } from 'tsup'
import path from 'path'
import fs from 'fs'

// Esbuild plugin: transform css-tree ESM files that use createRequire(import.meta.url)
// to use static requires instead, so esbuild can bundle the JSON inline.
const fixCssTreePlugin = {
  name: 'fix-css-tree-meta',
  setup(build: any) {
    // Match css-tree lib files that use import.meta
    build.onLoad({ filter: /css-tree[/\\]lib[/\\].*\.js$/ }, async (args: any) => {
      let contents = fs.readFileSync(args.path, 'utf-8')

      // Replace the pattern:
      //   import { createRequire } from 'module';
      //   const require = createRequire(import.meta.url);
      // with a direct static require of each JSON file used below
      if (!contents.includes('import.meta.url') && !contents.includes('createRequire')) {
        return null // no change needed
      }

      // Extract all require calls after createRequire pattern and inline them
      // Strategy: replace `createRequire(import.meta.url)("some/file.json")` with require("some/file.json")
      // Also replace the import { createRequire } + const require = createRequire(import.meta.url) pattern
      contents = contents
        .replace(/import\s*\{\s*createRequire\s*\}\s*from\s*['"]module['"];?\s*/g, '')
        .replace(/const\s+require\s*=\s*createRequire\(import\.meta\.url\);?\s*/g, '')

      return { contents, loader: 'js' }
    })
  },
}

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'component-benchmark': 'src/benchmarks/component-evidence.ts',
    'component-style-variant-benchmark': 'src/benchmarks/component-style-variants.ts',
    'runtime-discovery-benchmark': 'src/benchmarks/runtime-discovery.ts',
    'responsive-evidence-benchmark': 'src/benchmarks/responsive-evidence.ts',
    'responsive-skill-paths-benchmark': 'src/benchmarks/responsive-skill-paths.ts',
    'skill-context-benchmark': 'src/benchmarks/skill-context.ts',
  },
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  dts: false,
  external: ['playwright', 'oh-my-logo', 'ink', 'yoga-layout', 'react', 'react-devtools-core'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: [
    'chalk', 'ora', 'boxen', 'cli-progress', 'gradient-string',
    'prompts', 'strip-ansi', 'commander', 'archiver', 'css-tree',
    'culori', 'glob', 'jiti', 'postcss', 'simple-git', 'tmp',
    '@babel/parser', '@babel/traverse', '@babel/types',
    'mdn-data',
  ],
  esbuildPlugins: [fixCssTreePlugin],
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.json': 'json', '.cjs': 'js' };
  },
})
