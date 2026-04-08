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

const CACHE_TTL_MS = 60_000;
const _agentCache = new Map<string, { value: ResolvedAgent | null; ts: number }>();

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
  const cacheKey = `${projectPath}::${agentName}`;
  const cached = _agentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }
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
    if (agent) {
      _agentCache.set(cacheKey, { value: agent, ts: Date.now() });
      return agent;
    }
  }
  _agentCache.set(cacheKey, { value: null, ts: Date.now() });
  return null;
}

export async function resolveAgents(
  agentNames: string[],
  projectPath: string,
): Promise<{ resolved: Record<string, ResolvedAgent>; missing: string[] }> {
  const resolved: Record<string, ResolvedAgent> = {};
  const missing: string[] = [];
  const pairs = await Promise.all(agentNames.map(async (name) => ({
    name,
    agent: await resolveAgent(name, projectPath),
  })));
  for (const pair of pairs) {
    if (pair.agent) resolved[pair.name] = pair.agent;
    else missing.push(pair.name);
  }

  return { resolved, missing };
}
