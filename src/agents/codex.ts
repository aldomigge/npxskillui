import * as fs from 'fs';
import * as path from 'path';
import { AgentIntegrationContext } from './types';

export function installCodexIntegration(context: AgentIntegrationContext): boolean {
  try {
    const skillMdSrc = path.join(context.skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdSrc)) return false;

    const destDir = path.join(process.cwd(), '.agents', 'skills', context.skillFolderName);
    const source = path.resolve(context.skillDir);
    const destination = path.resolve(destDir);

    if (source !== destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true, force: true });
    }

    normalizeCodexSkillFrontmatter(path.join(destination, 'SKILL.md'), context.skillFolderName);
    return true;
  } catch {
    return false;
  }
}

function normalizeCodexSkillFrontmatter(skillMdPath: string, skillFolderName: string): void {
  if (!fs.existsSync(skillMdPath)) return;

  const safeName = skillFolderName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const normalized = content.replace(/^name:\s*.*$/m, `name: ${safeName}`);
  fs.writeFileSync(skillMdPath, normalized, 'utf-8');
}
