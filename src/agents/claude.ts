import * as fs from 'fs';
import * as path from 'path';
import { AgentIntegrationContext } from './types';

export function installClaudeIntegration(context: AgentIntegrationContext): boolean {
  writeClaudeMd(context.skillDir, context.projectName);

  try {
    const skillMdSrc = path.join(context.skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdSrc)) return false;

    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    if (!homeDir) return false;

    const destDir = path.join(homeDir, '.claude', 'skills', context.skillFolderName);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(skillMdSrc, path.join(destDir, 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
}

function writeClaudeMd(skillDir: string, projectName: string): void {
  try {
    const claudeMdPath = path.join(skillDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) return;

    const content = `# ${projectName} Design System

This project uses the **${projectName}** design system extracted by SkillUI.

## How to use

Read \`SKILL.md\` in this directory for the full design system reference before writing any UI code.

Key files:
- \`SKILL.md\` — master design reference (read this first)
- \`references/DESIGN.md\` — extended tokens and component specs
- \`references/ANIMATIONS.md\` — motion and keyframe specs
- \`references/LAYOUT.md\` — grid and layout containers
- \`references/COMPONENTS.md\` — DOM component patterns
- \`screens/scroll/\` — scroll journey screenshots (study before implementing)

When building any UI, always read SKILL.md first and match colors, fonts, spacing, and motion exactly.
`;

    fs.writeFileSync(claudeMdPath, content, 'utf-8');
  } catch {
    // Non-fatal integration helper.
  }
}
