export type AgentTarget = 'claude' | 'codex' | 'both';

export interface AgentIntegrationContext {
  skillDir: string;
  skillFolderName: string;
  projectName: string;
}

export interface AgentIntegrationResult {
  target: AgentTarget;
  installed: boolean;
  claudeInstalled: boolean;
  codexInstalled: boolean;
}
