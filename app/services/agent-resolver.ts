import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';

export interface ResolvedAgent {
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  maxTurns?: number;
}

async function tryReadAgentMd(path: string): Promise<ResolvedAgent | null> {
  try {
    const e = await exists(path);
    if (!e) return null;
    const content = await readTextFile(path);

    // Parse YAML frontmatter between --- delimiters
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) || {};
    const body = (match[2] ?? '').trim();

    return {
      name:            (frontmatter.name        as string) || '',
      description:     (frontmatter.description as string) || '',
      model:           (frontmatter.model       as string) || undefined,
      prompt:          body,
      tools:           Array.isArray(frontmatter.tools)            ? frontmatter.tools            as string[] : undefined,
      disallowedTools: Array.isArray(frontmatter.disallowedTools)  ? frontmatter.disallowedTools  as string[] : undefined,
      skills:          Array.isArray(frontmatter.skills)           ? frontmatter.skills           as string[] : undefined,
      maxTurns:        (frontmatter.maxTurns    as number) || undefined,
    };
  } catch {
    return null;
  }
}

export async function resolveAgent(
  agentName: string,
  projectPath: string,
): Promise<ResolvedAgent | null> {
  const home = await homeDir();

  // Resolution order:
  // 1. <project>/.claude/agents/<name>.md
  // 2. ~/.claude/agents/<name>.md
  const candidates = [
    `${projectPath}/.claude/agents/${agentName}.md`,
    `${home}/.claude/agents/${agentName}.md`,
  ];

  for (const path of candidates) {
    const agent = await tryReadAgentMd(path);
    if (agent) return agent;
  }

  return null;
}

export async function resolveAgents(
  agentNames: string[],
  projectPath: string,
): Promise<{ resolved: Record<string, ResolvedAgent>; missing: string[] }> {
  const resolved: Record<string, ResolvedAgent> = {};
  const missing: string[] = [];

  for (const name of agentNames) {
    const agent = await resolveAgent(name, projectPath);
    if (agent) {
      resolved[name] = agent;
    } else {
      missing.push(name);
    }
  }

  return { resolved, missing };
}
