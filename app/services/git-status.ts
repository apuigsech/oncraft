import { invoke } from '@tauri-apps/api/core';

export type FileGitStatus = 'clean' | 'modified' | 'missing';

export async function getFilesGitStatus(
  repoPath: string,
  filePaths: string[],
): Promise<Record<string, FileGitStatus>> {
  if (!repoPath || filePaths.length === 0) return {};
  try {
    const result = await invoke<Record<string, string>>('git_file_status', {
      repoPath,
      filePaths,
    });
    if ('error' in result) return {};
    // Cast values to FileGitStatus
    const out: Record<string, FileGitStatus> = {};
    for (const [k, v] of Object.entries(result)) {
      out[k] = (v as FileGitStatus) || 'clean';
    }
    return out;
  } catch {
    return {};
  }
}
