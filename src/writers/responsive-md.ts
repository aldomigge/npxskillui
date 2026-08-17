import type { Breakpoint, DesignProfile } from '../types';
import type { ResponsiveEvidenceResult } from '../types-ultra';
import { summarizeResponsiveChanges } from '../extractors/ultra/responsive-summary';

export function generateResponsiveMd(
  result: ResponsiveEvidenceResult,
  profile: DesignProfile
): string {
  let md = `# Responsive Runtime Reference\n\n`;
  md += `> Measured from rendered pages at explicitly sampled viewport sizes.\n`;
  md += `> A sampled viewport is evidence of what happened at that size; it is **not** proof of the exact CSS breakpoint where the change begins.\n`;
  md += `> Structural comparisons intentionally ignore ordinary fluid geometry changes and uncorroborated DOM presence/absence differences.\n`;
  md += `> Repeated descendant visibility flips are condensed into representative component-family transitions so one hidden parent does not dominate the report.\n\n`;

  if (result.pages.length === 0 || result.viewports.length === 0) {
    md += `No responsive runtime samples were captured.\n`;
    return md;
  }

  md += `## Sampled Viewports\n\n`;
  md += result.viewports.map(viewport => `- \`${viewport.key}\``).join('\n');
  md += `\n\n`;

  if (profile.breakpoints.length > 0) {
    md += `## Declared CSS Breakpoints\n\n`;
    md += `These values came from CSS/token extraction and are separate from the sampled runtime viewports.\n\n`;
    md += renderBreakpoints(profile.breakpoints);
  }

  md += `## Coverage\n\n`;
  md += `| Page | Viewport | DOM Elements | Document Size | Horizontal Overflow | Lazy Growth | Screenshot |\n`;
  md += `|------|----------|--------------|---------------|---------------------|-------------|------------|\n`;

  for (const page of result.pages) {
    for (const observation of page.observations) {
      const growth = observation.discovery.grew
        ? `yes (${observation.discovery.beforeElementCount}→${observation.discovery.afterElementCount})`
        : 'no';
      md += `| \`${page.pageUrl}\` | \`${observation.viewport.key}\` | ${observation.domElementCount} | ${observation.documentWidth}×${observation.documentHeight}px | ${observation.horizontalOverflow ? '**yes**' : 'no'} | ${growth} | \`${observation.screenshotPath}\` |\n`;
    }
  }
  md += `\n`;

  for (const page of result.pages) {
    md += `## ${page.pageTitle || page.pageSlug}\n\n`;
    md += `**URL:** \`${page.pageUrl}\`\n\n`;

    md += `### Screenshots\n\n`;
    for (const observation of page.observations) {
      md += `#### ${observation.viewport.key}\n\n`;
      md += `![${page.pageTitle} at ${observation.viewport.key}](../${observation.screenshotPath})\n\n`;
    }

    if (page.comparisons.length === 0) {
      md += `Only one viewport was sampled for this page, so no cross-viewport structural comparison is available.\n\n`;
      continue;
    }

    md += `### Structural Changes\n\n`;
    for (const comparison of page.comparisons) {
      md += `#### ${comparison.target.key} vs ${comparison.baseline.key} baseline\n\n`;

      const summary = summarizeResponsiveChanges(comparison.changes);
      const renderedChanges = summary.changes;

      if (renderedChanges.length === 0) {
        md += `No high-confidence tracked structural changes were measured between these two samples.\n\n`;
        continue;
      }

      md += `| Element | Property | ${comparison.baseline.key} | ${comparison.target.key} |\n`;
      md += `|---------|----------|----------------|----------------|\n`;
      for (const change of renderedChanges.slice(0, 40)) {
        md += `| \`${compactSelector(change.selector)}\` | ${change.property} | \`${escapeCell(change.from)}\` | \`${escapeCell(change.to)}\` |\n`;
      }
      md += `\n`;

      if (summary.omittedVisibilityChanges > 0) {
        md += `> Condensed ${summary.omittedVisibilityChanges} redundant descendant/same-family visibility transition(s). Screenshots preserve the complete visual context.\n\n`;
      }
      if (renderedChanges.length > 40) {
        md += `> ${renderedChanges.length - 40} additional summarized structural changes were omitted from this compact table.\n\n`;
      }
    }
  }

  md += `## Responsive Evidence Rules\n\n`;
  md += `- Treat screenshots and measured structural changes as runtime evidence for the exact sampled viewport only.\n`;
  md += `- Do not infer an exact breakpoint threshold from two sampled viewport sizes. Use declared CSS breakpoints when available.\n`;
  md += `- A hidden/visible transition for the same structural identity is stronger evidence than a geometry change.\n`;
  md += `- Repeated child visibility changes caused by the same component-family transition are condensed; they are not counted as independent responsive rules.\n`;
  md += `- A node present in only one runtime sample is not promoted as responsive evidence because lazy loading, carousel state, or timing can also change DOM presence.\n`;
  md += `- Flex/grid/display/position changes are structural evidence; ordinary fluid width/height changes are intentionally not listed as mode switches.\n`;
  md += `- Grid column evidence is reported only when the measured number of tracks changes; pixel resizing with the same track count is treated as fluid geometry.\n`;
  md += `- Horizontal overflow is a warning signal to inspect the screenshot; it is not automatically a source-site defect.\n`;
  md += `- Responsive evidence does not promote new canonical components in this extraction stage.\n`;

  return md;
}

function renderBreakpoints(breakpoints: Breakpoint[]): string {
  let md = `| Name | Value | Source |\n`;
  md += `|------|-------|--------|\n`;
  for (const breakpoint of breakpoints) {
    md += `| ${breakpoint.name || 'unnamed'} | \`${breakpoint.value}\` | ${breakpoint.source} |\n`;
  }
  md += `\n`;
  return md;
}

function compactSelector(value: string): string {
  const escaped = escapeCell(value);
  if (escaped.length <= 120) return escaped;
  return `${escaped.slice(0, 56)}…${escaped.slice(-56)}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/`/g, '\\`');
}
