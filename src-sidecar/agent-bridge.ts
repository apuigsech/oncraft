import { query, getSessionMessages, listSessions, type SDKMessage, type SDKUserMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import cliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { createInterface } from "readline";
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from "fs";
import { join, basename, relative } from "path";
import { homedir } from "os";

// ---- load env vars from ~/.claude/settings.json ----
function loadClaudeEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    if (settings.env && typeof settings.env === "object") {
      for (const [key, value] of Object.entries(settings.env)) {
        if (typeof value === "string") {
          env[key] = value;
        }
      }
      process.stderr.write(`[agent-bridge] loaded ${Object.keys(settings.env).length} env vars from ~/.claude/settings.json\n`);
    }
  } catch (err) {
    process.stderr.write(`[agent-bridge] could not load ~/.claude/settings.json: ${err}\n`);
  }
  return env;
}

const claudeEnv = loadClaudeEnv();

// ---- stdout helpers ----
function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function emitError(message: string, details?: Record<string, unknown>): void {
  emit({ type: "error", message, ...details });
}

// ---- state ----
let pendingApproval: ((answer: string) => void) | null = null;
let currentAbort: AbortController | null = null;

// ---- message translation ----
function translateMessage(
  msg: SDKMessage,
): Record<string, unknown> | Record<string, unknown>[] | null {
  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (!content || !Array.isArray(content)) return null;

    const results: Record<string, unknown>[] = [];
    for (const block of content) {
      if (block.type === "text") {
        results.push({
          type: "assistant",
          content: block.text,
          usage: msg.message?.usage
            ? {
                inputTokens: msg.message.usage.input_tokens,
                outputTokens: msg.message.usage.output_tokens,
              }
            : undefined,
        });
      } else if (block.type === "tool_use") {
        results.push({
          type: "tool_use",
          toolName: block.name,
          toolInput: block.input,
          toolUseId: block.id,
        });
      } else if (block.type === "thinking") {
        results.push({
          type: "assistant",
          content: (block as { thinking?: string }).thinking || "",
          subtype: "thinking",
        });
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }

  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!content) return null;

    // Content can be a plain string
    if (typeof content === "string") {
      return { type: "user", content };
    }

    if (!Array.isArray(content)) return null;

    const results: Record<string, unknown>[] = [];
    const images: { data: string; mediaType: string; name: string }[] = [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "text") {
        results.push({ type: "user", content: block.text });
      } else if (block.type === "image") {
        const source = block.source as { type: string; media_type: string; data: string } | undefined;
        if (source?.type === "base64" && source.data) {
          images.push({
            data: source.data,
            mediaType: source.media_type,
            name: "image",
          });
        }
      } else if (block.type === "tool_result") {
        results.push({
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
        });
      }
    }
    // Attach extracted images to the first user text message
    if (images.length > 0 && results.length > 0) {
      const firstUser = results.find(r => r.type === "user");
      if (firstUser) {
        firstUser.images = images;
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }

  if (msg.type === "result") {
    return {
      type: "result",
      sessionId: msg.session_id,
      costUsd: (msg as { total_cost_usd?: number }).total_cost_usd,
      durationMs: (msg as { duration_ms?: number }).duration_ms,
      usage: (msg as { usage?: { input_tokens: number; output_tokens: number } }).usage
        ? {
            inputTokens: (msg as { usage: { input_tokens: number } }).usage.input_tokens,
            outputTokens: (msg as { usage: { output_tokens: number } }).usage.output_tokens,
          }
        : undefined,
    };
  }

  if (msg.type === "system") {
    const sysMsg = msg as Record<string, unknown>;
    const subtype = sysMsg.subtype as string | undefined;
    if (subtype === "init") {
      const worktree = sysMsg.worktree as { path?: string; branch?: string } | undefined;
      return {
        type: "system",
        subtype: "init",
        sessionId: sysMsg.session_id,
        gitBranch: sysMsg.git_branch || undefined,
        model: sysMsg.model || undefined,
        slashCommands: sysMsg.slash_commands || [],
        skills: sysMsg.skills || [],
        tools: sysMsg.tools || [],
        worktreePath: worktree?.path || undefined,
        worktreeBranch: worktree?.branch || undefined,
      };
    }
    if (subtype === "hook_started") {
      return {
        type: "hook_started",
        hookId: sysMsg.hook_id,
        hookName: sysMsg.hook_name,
        hookEvent: sysMsg.hook_event,
      };
    }
    if (subtype === "hook_progress") {
      return {
        type: "hook_progress",
        hookId: sysMsg.hook_id,
        hookName: sysMsg.hook_name,
        hookEvent: sysMsg.hook_event,
        stdout: sysMsg.stdout || "",
        stderr: sysMsg.stderr || "",
        output: sysMsg.output || "",
      };
    }
    if (subtype === "hook_response") {
      return {
        type: "hook_response",
        hookId: sysMsg.hook_id,
        hookName: sysMsg.hook_name,
        hookEvent: sysMsg.hook_event,
        output: sysMsg.output || "",
        exitCode: sysMsg.exit_code,
        outcome: sysMsg.outcome || "unknown",
      };
    }
    if (subtype === "task_started") {
      return {
        type: "task_started",
        taskId: sysMsg.task_id,
        description: sysMsg.description || "",
        taskType: sysMsg.task_type,
        prompt: sysMsg.prompt,
      };
    }
    if (subtype === "task_progress") {
      return {
        type: "task_progress",
        taskId: sysMsg.task_id,
        description: sysMsg.description || "",
        usage: sysMsg.usage,
        lastToolName: sysMsg.last_tool_name,
        summary: sysMsg.summary,
      };
    }
    if (subtype === "task_notification") {
      return {
        type: "task_notification",
        taskId: sysMsg.task_id,
        ...sysMsg,  // pass through remaining fields
      };
    }
    if (subtype === "status") {
      return {
        type: "status",
        status: sysMsg.status,
        permissionMode: sysMsg.permissionMode,
      };
    }
    if (subtype === "compact_boundary") {
      return {
        type: "compact_boundary",
        compactMetadata: sysMsg.compact_metadata,
      };
    }
    if (subtype === "local_command_output") {
      return {
        type: "local_command_output",
        content: sysMsg.content || "",
      };
    }
    if (subtype === "files_persisted") {
      return {
        type: "files_persisted",
        files: sysMsg.files || [],
        failed: sysMsg.failed || [],
      };
    }
    if (subtype === "elicitation_complete") {
      return {
        type: "elicitation_complete",
        mcpServerName: sysMsg.mcp_server_name,
        elicitationId: sysMsg.elicitation_id,
      };
    }
    // For any other system subtype, keep the existing generic handler:
    return {
      type: "system",
      subtype: sysMsg.subtype || "unknown",
      content: sysMsg.message || sysMsg.subtype || "",
    };
  }

  // Streaming partial messages (token-by-token text)
  if (msg.type === "stream_event") {
    const event = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return {
          type: "assistant",
          subtype: "streaming",
          content: delta.text,
        };
      }
    }
    // Skip other stream events (message_start, content_block_start, etc.)
    return null;
  }

  if (msg.type === "tool_progress") {
    const m = msg as Record<string, unknown>;
    return {
      type: "tool_progress",
      toolUseId: m.tool_use_id,
      toolName: m.tool_name,
      elapsedSeconds: m.elapsed_time_seconds,
      taskId: m.task_id,
    };
  }

  if (msg.type === "auth_status") {
    const m = msg as Record<string, unknown>;
    return {
      type: "auth_status",
      isAuthenticating: m.isAuthenticating,
      output: m.output || [],
      error: m.error,
    };
  }

  if (msg.type === "rate_limit_event") {
    const m = msg as Record<string, unknown>;
    return {
      type: "rate_limit_event",
      rateLimitInfo: m.rate_limit_info || m.rateLimitInfo || {},
    };
  }

  if (msg.type === "tool_use_summary") {
    const m = msg as Record<string, unknown>;
    return {
      type: "tool_use_summary",
      summary: m.summary || "",
      precedingToolUseIds: m.preceding_tool_use_ids || [],
    };
  }

  if (msg.type === "prompt_suggestion") {
    const m = msg as Record<string, unknown>;
    return {
      type: "prompt_suggestion",
      suggestion: m.suggestion || "",
    };
  }

  // Pass through unknown types with their raw data
  return {
    type: "unknown",
    rawType: String((msg as Record<string, unknown>).type),
    data: msg,
  };
}

// ---- main loop ----
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line: string) => {
  let cmd: Record<string, unknown>;
  try {
    cmd = JSON.parse(line);
  } catch {
    emitError("Invalid JSON on stdin");
    return;
  }

  // Handle reply to pending tool approval
  if (cmd.cmd === "reply" && pendingApproval) {
    pendingApproval(cmd.content as string);
    pendingApproval = null;
    return;
  }

  // Handle interrupt
  if (cmd.cmd === "interrupt") {
    if (currentAbort) {
      currentAbort.abort();
    }
    return;
  }

  // Handle stop
  if (cmd.cmd === "stop") {
    process.exit(0);
  }

  // Handle start
  if (cmd.cmd === "start") {
    currentAbort = new AbortController();
    process.stderr.write(`[agent-bridge] starting query, cwd=${cmd.projectPath}\n`);

    try {
      // Build multimodal prompt when images are attached.
      // Images are passed as file paths (written by the frontend to temp dir)
      // to avoid sending large base64 payloads over stdin IPC.
      // The SDK's query() accepts prompt: string | AsyncIterable<SDKUserMessage>.
      const imagePaths = cmd.imagePaths as { path: string; mediaType: string }[] | undefined;
      let promptValue: string | AsyncIterable<SDKUserMessage>;
      if (imagePaths && Array.isArray(imagePaths) && imagePaths.length > 0) {
        process.stderr.write(`[agent-bridge] multimodal prompt with ${imagePaths.length} image(s) from temp files\n`);
        const contentBlocks: Record<string, unknown>[] = [];
        for (const img of imagePaths) {
          try {
            const data = readFileSync(img.path, "base64");
            contentBlocks.push({
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data },
            });
            // Clean up temp file after reading
            try { unlinkSync(img.path); } catch { /* ignore */ }
          } catch (err) {
            process.stderr.write(`[agent-bridge] failed to read image ${img.path}: ${err}\n`);
          }
        }
        if (contentBlocks.length > 0) {
          contentBlocks.push({ type: "text", text: cmd.prompt as string });
          const userMessage = {
            type: "user" as const,
            message: { role: "user" as const, content: contentBlocks },
            parent_tool_use_id: null,
            session_id: "",
          } as unknown as SDKUserMessage;
          promptValue = (async function* () { yield userMessage; })();
        } else {
          // All images failed to load, fall back to text-only
          promptValue = cmd.prompt as string;
        }
      } else {
        promptValue = cmd.prompt as string;
      }

      const conversation = query({
        prompt: promptValue as any,
        options: {
          pathToClaudeCodeExecutable: cliPath,
          executable: "node",
          env: claudeEnv,
          cwd: cmd.projectPath as string,
          resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
          abortController: currentAbort,
          model: (cmd.model as string) || undefined,
          effort: (cmd.effort as string) || undefined,
          permissionMode: (cmd.permissionMode as string) || "default",
          settingSources: ["user", "project"],
          includePartialMessages: true,
          ...(cmd.worktreeName ? {
            extraArgs: { worktree: cmd.worktreeName as string },
          } : {}),
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
            options: { toolUseID: string },
          ): Promise<PermissionResult> => {
            // Emit tool_confirmation to stdout and block until reply arrives
            emit({
              type: "tool_confirmation",
              toolName,
              toolInput: input,
              toolUseId: options.toolUseID,
            });
            // Wait for the reply command from stdin
            const answer = await new Promise<string>((resolve) => {
              pendingApproval = resolve;
            });
            return answer === "allow"
              ? { behavior: "allow" as const }
              : { behavior: "deny" as const, message: "User denied" };
          },
        },
      });

      for await (const message of conversation) {
        const translated = translateMessage(message);
        if (translated) {
          if (Array.isArray(translated)) {
            for (const t of translated) emit(t);
          } else {
            emit(translated);
          }
        }
      }
    } catch (err: unknown) {
      process.stderr.write(`[agent-bridge] error: ${String(err)}\n`);
      process.stderr.write(`[agent-bridge] error stack: ${(err as Error).stack || 'no stack'}\n`);
      if ((err as Error).name === "AbortError") {
        emit({
          type: "system",
          subtype: "interrupted",
          content: "Query interrupted",
        });
      } else {
        emitError(String(err));
      }
    } finally {
      currentAbort = null;
    }
    return;
  }

  // Handle loadHistory
  if (cmd.cmd === "loadHistory") {
    try {
      const sessionId = cmd.sessionId as string;
      process.stderr.write(`[agent-bridge] loading history for session ${sessionId}\n`);
      const history = await getSessionMessages(sessionId);
      const translated: Record<string, unknown>[] = [];
      for (const msg of history) {
        const t = translateMessage(msg as SDKMessage);
        if (t) {
          if (Array.isArray(t)) {
            translated.push(...t);
          } else {
            translated.push(t);
          }
        }
      }
      emit({ type: "history", messages: translated });
    } catch (err) {
      process.stderr.write(`[agent-bridge] history error: ${err}\n`);
      emit({ type: "history", messages: [], error: String(err) });
    }
    return;
  }

  // Handle listCommands — scan filesystem for available commands and skills
  if (cmd.cmd === "listCommands") {
    const projectDir = cmd.projectPath as string | undefined;
    const commands: { name: string; desc: string; source: string }[] = [];

    function scanCommandDir(dir: string, prefix: string, source: string): void {
      try {
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanCommandDir(fullPath, prefix ? `${prefix}:${entry.name}` : entry.name, source);
          } else if (entry.name.endsWith(".md")) {
            const name = entry.name.replace(/\.md$/, "");
            const cmdName = prefix ? `/${prefix}:${name}` : `/${name}`;
            // Try to extract description from frontmatter
            let desc = source;
            try {
              const content = readFileSync(fullPath, "utf-8");
              const match = content.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---/);
              if (match) desc = match[1].trim();
            } catch { /* ignore */ }
            commands.push({ name: cmdName, desc, source });
          }
        }
      } catch { /* ignore unreadable dirs */ }
    }

    function scanSkillDir(dir: string, source: string): void {
      try {
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = join(dir, entry.name, "SKILL.md");
            if (existsSync(skillMd)) {
              let desc = source;
              try {
                const content = readFileSync(skillMd, "utf-8");
                const match = content.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---/);
                if (match) desc = match[1].trim();
              } catch { /* ignore */ }
              commands.push({ name: `/${entry.name}`, desc, source });
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Scan user-level commands and skills
    const home = homedir();
    scanCommandDir(join(home, ".claude", "commands"), "", "user command");
    scanSkillDir(join(home, ".claude", "skills"), "user skill");

    // Scan project-level commands and skills
    if (projectDir) {
      scanCommandDir(join(projectDir, ".claude", "commands"), "", "project command");
      scanSkillDir(join(projectDir, ".claude", "skills"), "project skill");
    }

    // Scan plugin cache for both commands/ and skills/
    try {
      const cacheDir = join(home, ".claude", "plugins", "cache");
      if (existsSync(cacheDir)) {
        const vendors = readdirSync(cacheDir, { withFileTypes: true });
        for (const vendor of vendors) {
          if (!vendor.isDirectory()) continue;
          const plugins = readdirSync(join(cacheDir, vendor.name), { withFileTypes: true });
          for (const plugin of plugins) {
            if (!plugin.isDirectory()) continue;
            // Find latest version
            const versions = readdirSync(join(cacheDir, vendor.name, plugin.name), { withFileTypes: true })
              .filter(v => v.isDirectory())
              .map(v => v.name)
              .sort()
              .reverse();
            if (versions.length === 0) continue;
            const latestDir = join(cacheDir, vendor.name, plugin.name, versions[0]);
            const pluginName = plugin.name;
            const pluginLabel = `plugin: ${pluginName}`;

            // Scan commands/ (e.g. speckit-specify.md -> /spec-kit:speckit-specify)
            const commandsDir = join(latestDir, "commands");
            if (existsSync(commandsDir)) {
              try {
                const entries = readdirSync(commandsDir, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.name.endsWith(".md")) {
                    const cmdBase = entry.name.replace(/\.md$/, "");
                    const cmdName = `/${pluginName}:${cmdBase}`;
                    let desc = pluginLabel;
                    try {
                      const content = readFileSync(join(commandsDir, entry.name), "utf-8");
                      const match = content.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---/);
                      if (match) desc = match[1].trim().replace(/^['"]|['"]$/g, "");
                    } catch { /* ignore */ }
                    commands.push({ name: cmdName, desc, source: pluginLabel });
                  }
                }
              } catch { /* ignore */ }
            }

            // Scan skills/ (e.g. spec-writing/SKILL.md -> /spec-kit:spec-writing)
            const skillsDir = join(latestDir, "skills");
            if (existsSync(skillsDir)) {
              try {
                const entries = readdirSync(skillsDir, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.isDirectory()) {
                    const skillMd = join(skillsDir, entry.name, "SKILL.md");
                    if (existsSync(skillMd)) {
                      let desc = pluginLabel;
                      try {
                        const content = readFileSync(skillMd, "utf-8");
                        const match = content.match(/^---\n[\s\S]*?description:\s*['"]*(.+?)['"]*\n/);
                        if (match) desc = match[1].trim();
                      } catch { /* ignore */ }
                      commands.push({ name: `/${pluginName}:${entry.name}`, desc, source: pluginLabel });
                    }
                  }
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch { /* ignore */ }

    // Deduplicate by name (keep first occurrence which has better description)
    const seen = new Set<string>();
    const dedupedCommands = commands.filter(c => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });

    emit({ type: "commands", commands: dedupedCommands });
    return;
  }

  // Handle listSessions — get all Claude sessions for a project
  if (cmd.cmd === "listSessions") {
    try {
      const projectPath = cmd.projectPath as string;
      const allSessions = await listSessions({ cwd: projectPath });
      // Filter to sessions from this project path
      const projectSessions = allSessions
        .filter(s => s.cwd === projectPath)
        .map(s => ({
          sessionId: s.sessionId,
          summary: s.summary || s.firstPrompt || s.sessionId,
          lastModified: s.lastModified,
          createdAt: (s as Record<string, unknown>).createdAt || s.lastModified,
          gitBranch: (s as Record<string, unknown>).gitBranch || '',
        }))
        .sort((a, b) => b.lastModified - a.lastModified);
      emit({ type: "sessions", sessions: projectSessions });
    } catch (err) {
      process.stderr.write(`[agent-bridge] listSessions error: ${err}\n`);
      emit({ type: "sessions", sessions: [], error: String(err) });
    }
    return;
  }

  // Handle deleteSession — remove Claude session JSONL files
  if (cmd.cmd === "deleteSession") {
    const sessionId = cmd.sessionId as string;
    const projectPath = cmd.projectPath as string | undefined;
    let deleted = false;

    try {
      const home = homedir();
      const projectsDir = join(home, ".claude", "projects");
      if (existsSync(projectsDir)) {
        // Search all project dirs for this session
        const dirs = readdirSync(projectsDir, { withFileTypes: true });
        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;
          const jsonlPath = join(projectsDir, dir.name, `${sessionId}.jsonl`);
          if (existsSync(jsonlPath)) {
            unlinkSync(jsonlPath);
            deleted = true;
            process.stderr.write(`[agent-bridge] deleted session file: ${jsonlPath}\n`);
          }
        }
      }
    } catch (err) {
      process.stderr.write(`[agent-bridge] delete session error: ${err}\n`);
    }

    emit({ type: "sessionDeleted", sessionId, deleted });
    return;
  }

  emitError(`Unknown command: ${cmd.cmd}`);
});

// Handle stdin close (Tauri killed us)
rl.on("close", () => {
  process.exit(0);
});
