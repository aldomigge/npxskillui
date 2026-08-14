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

    // If the caller already chose .agents/skills as --out, the generated skill
    // is already in the location Codex discovers automatically.
    if (source === destination) return true;

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
