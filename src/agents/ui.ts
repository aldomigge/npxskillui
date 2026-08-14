import * as path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import type { DesignProfile } from '../types';
import type { FullAnimationResult } from '../types-ultra';
import type { AgentTarget } from './types';

export async function promptAgentTarget(initial: AgentTarget = 'claude'): Promise<AgentTarget> {
  const prompts = (await import('prompts')).default;
  const answer = await prompts({
    type: 'select',
    name: 'agent',
    message: chalk.white('Agent integration?'),
    choices: [
      { title: 'Claude Code', value: 'claude' },
      { title: 'Codex', value: 'codex' },
      { title: 'Claude Code + Codex', value: 'both' },
    ],
    initial: initial === 'codex' ? 1 : initial === 'both' ? 2 : 0,
  }, { onCancel: () => process.exit(0) });

  return (answer.agent || initial) as AgentTarget;
}

interface ResultsData {
  profile: DesignProfile;
  animations?: FullAnimationResult;
  skillFilePath?: string;
  designMdPath?: string;
  projectName: string;
  skillInstalled?: boolean;
  agent: AgentTarget;
}

export function showAgentResults(data: ResultsData): void {
  const { profile, animations, skillFilePath, designMdPath, projectName, skillInstalled, agent } = data;
  const fontCount = new Set(profile.typography.map(t => t.fontFamily)).size;
  const framework = profile.frameworks.map(f => f.name).join(', ') || 'none detected';

  const rows = [
    `  ${chalk.cyan('Colors'.padEnd(20))}${chalk.white.bold(`${profile.colors.length} extracted`)}`,
    `  ${chalk.cyan('Fonts'.padEnd(20))}${chalk.white.bold(`${fontCount} families`)}`,
    `  ${chalk.cyan('Components'.padEnd(20))}${chalk.white.bold(`${profile.components.length} patterns`)}`,
    `  ${chalk.cyan('Framework'.padEnd(20))}${chalk.white.bold(framework)}`,
  ];

  if (animations?.scrollFrames.length) {
    rows.push(`  ${chalk.cyan('Scroll frames'.padEnd(20))}${chalk.white.bold(`${animations.scrollFrames.length} captured`)}`);
  }

  console.log('');
  console.log(boxen(rows.join('\n'), {
    title: chalk.bold.magenta(' Extraction Complete '),
    borderStyle: 'double',
    borderColor: 'magenta',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');

  const rel = (p: string) => './' + path.relative(process.cwd(), p).replace(/\\/g, '/');
  const outputRows: string[] = [];
  if (designMdPath) outputRows.push(`  ${chalk.green('DESIGN.md'.padEnd(18))}${chalk.dim(rel(designMdPath))}`);
  if (skillFilePath) outputRows.push(`  ${chalk.green((projectName + '.skill').padEnd(18))}${chalk.dim(rel(skillFilePath))}`);

  if (outputRows.length) {
    console.log(boxen(outputRows.join('\n'), {
      title: chalk.bold(' Output files '),
      borderStyle: 'round',
      borderColor: 'green',
      width: 76,
      padding: { top: 0, bottom: 0, left: 0, right: 1 },
    }));
    console.log('');
  }

  const nextSteps: string[] = [];

  if (agent === 'claude' || agent === 'both') {
    nextSteps.push(chalk.dim('  Claude Code'));
    nextSteps.push(`    ${chalk.cyan(`cd ${projectName}-design && claude`)}`);
    nextSteps.push('    ' + chalk.dim('Claude reads CLAUDE.md and the installed SKILL.md.'));
  }

  if (agent === 'both') nextSteps.push('');

  if (agent === 'codex' || agent === 'both') {
    nextSteps.push(chalk.dim('  Codex'));
    nextSteps.push(`    ${chalk.cyan('codex')}`);
    nextSteps.push(`    ${chalk.dim(`Skill: .agents/skills/${projectName}-design/SKILL.md`)}`);
    nextSteps.push('    ' + chalk.dim('Use /skills or mention the skill with $ when invoking it explicitly.'));
  }

  if (skillFilePath) {
    nextSteps.push('');
    nextSteps.push(skillInstalled
      ? chalk.green('  Requested agent integration installed successfully.')
      : chalk.yellow('  Skill generated, but one or more agent integrations could not be installed automatically.'));
  }

  console.log(boxen(nextSteps.join('\n'), {
    title: chalk.bold(' Next steps '),
    borderStyle: 'round',
    borderColor: 'green',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');
}
