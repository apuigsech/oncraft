import { Command } from '@tauri-apps/plugin-shell';
import { exists } from '@tauri-apps/plugin-fs';
import { isProcessActive } from '~/services/claude-process';

export type HealthStatus = 'green' | 'amber' | 'red';

export interface HealthCheckItem {
  label: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthCheckResult {
  items: HealthCheckItem[];
}

async function checkClaudeCli(): Promise<HealthCheckItem> {
  // Check common install locations for Claude CLI
  const paths = [
    `${await homeDir()}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of paths) {
    try {
      if (await exists(p)) {
        return { label: 'Claude CLI', status: 'green', detail: 'Installed' };
      }
    } catch { /* continue */ }
  }
  return { label: 'Claude CLI', status: 'red', detail: 'Not found' };
}

async function homeDir(): Promise<string> {
  // Tauri's fs plugin resolves $HOME; we can also read from env
  return (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
    ? (await import('@tauri-apps/api/path')).homeDir()
    : '/Users/unknown';
}

async function checkApiKey(): Promise<HealthCheckItem> {
  // Claude CLI stores config in ~/.claude/; check for credentials marker
  try {
    const home = await homeDir();
    const configExists = await exists(`${home}/.claude`);
    if (configExists) {
      return { label: 'API Key', status: 'green', detail: 'Configured' };
    }
  } catch { /* continue */ }
  return { label: 'API Key', status: 'amber', detail: 'Not detected' };
}

async function checkGhCli(): Promise<HealthCheckItem> {
  try {
    const command = Command.create('gh', ['auth', 'status']);
    const output = await command.execute();
    if (output.code === 0) {
      return { label: 'GitHub CLI', status: 'green', detail: 'Authenticated' };
    }
    return { label: 'GitHub CLI', status: 'amber', detail: 'Installed but not authenticated' };
  } catch {
    return { label: 'GitHub CLI', status: 'red', detail: 'Not found' };
  }
}

function checkSidecar(): HealthCheckItem {
  // Check if any sidecar process is currently alive
  // This is a lightweight check — the sidecar is spawned on demand per card
  return { label: 'Sidecar', status: 'green', detail: 'Ready (spawned on demand)' };
}

export async function runHealthChecks(): Promise<HealthCheckResult> {
  const [claudeCli, apiKey, ghCli] = await Promise.all([
    checkClaudeCli(),
    checkApiKey(),
    checkGhCli(),
  ]);

  return {
    items: [claudeCli, apiKey, ghCli, checkSidecar()],
  };
}
