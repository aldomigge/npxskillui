import { installClaudeIntegration } from './claude';
import { installCodexIntegration } from './codex';
import { AgentIntegrationContext, AgentIntegrationResult, AgentTarget } from './types';

export function installAgentIntegrations(
  target: AgentTarget,
  context: AgentIntegrationContext
): AgentIntegrationResult {
  let claudeInstalled = false;
  let codexInstalled = false;

  // Install Codex first so --agent both does not copy CLAUDE.md into the Codex
  // skill directory when the source and destination are different.
  if (target === 'codex' || target === 'both') {
    codexInstalled = installCodexIntegration(context);
  }

  if (target === 'claude' || target === 'both') {
    claudeInstalled = installClaudeIntegration(context);
  }

  const installed = target === 'both'
    ? claudeInstalled && codexInstalled
    : target === 'claude'
      ? claudeInstalled
      : codexInstalled;

  return { target, installed, claudeInstalled, codexInstalled };
}

export type { AgentIntegrationContext, AgentIntegrationResult, AgentTarget } from './types';
