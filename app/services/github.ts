import { Command } from '@tauri-apps/plugin-shell';
import type { GitHubIssue } from '~/types';

// ─── gh CLI helpers ──────────────────────────────────────────────────────────

async function runGh(args: string[], cwd?: string): Promise<string> {
  const command = Command.create('gh', args, cwd ? { cwd } : undefined);
  const output = await command.execute();
  if (output.code !== 0) {
    throw new Error(output.stderr || `gh exited with code ${output.code}`);
  }
  return output.stdout;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const issueCache = new Map<string, CacheEntry<GitHubIssue[]>>();

function getCached(key: string): GitHubIssue[] | null {
  const entry = issueCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    issueCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: GitHubIssue[]): void {
  issueCache.set(key, { data, timestamp: Date.now() });
}

export function clearCache(): void {
  issueCache.clear();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listIssues(repo: string, query?: string): Promise<GitHubIssue[]> {
  const cacheKey = `${repo}:${query || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const args = ['issue', 'list', '--repo', repo, '--json', 'number,title,labels,state', '--limit', '50'];
  if (query) {
    args.push('--search', query);
  }

  const stdout = await runGh(args);
  const raw = JSON.parse(stdout) as Array<{ number: number; title: string; labels: Array<{ name: string }>; state: string }>;
  const issues: GitHubIssue[] = raw.map(i => ({
    number: i.number,
    title: i.title,
    labels: i.labels.map(l => l.name),
    state: i.state,
  }));

  setCache(cacheKey, issues);
  return issues;
}

export async function getIssue(repo: string, number: number): Promise<GitHubIssue> {
  const stdout = await runGh([
    'issue', 'view', String(number), '--repo', repo,
    '--json', 'number,title,body,labels,state',
  ]);
  const raw = JSON.parse(stdout) as { number: number; title: string; body: string; labels: Array<{ name: string }>; state: string };
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    labels: raw.labels.map(l => l.name),
    state: raw.state,
  };
}

export async function closeIssue(repo: string, number: number, comment?: string): Promise<void> {
  const args = ['issue', 'close', String(number), '--repo', repo];
  if (comment) {
    args.push('--comment', comment);
  }
  await runGh(args);
}

export async function checkGhStatus(): Promise<{ installed: boolean; authenticated: boolean }> {
  try {
    const command = Command.create('gh', ['auth', 'status']);
    const output = await command.execute();
    return { installed: true, authenticated: output.code === 0 };
  } catch {
    return { installed: false, authenticated: false };
  }
}

export async function detectRepo(projectPath: string): Promise<string | null> {
  try {
    const stdout = await runGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], projectPath);
    const repo = stdout.trim();
    return repo || null;
  } catch {
    return null;
  }
}
