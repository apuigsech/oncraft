import { query, startup, getSessionMessages, listSessions, tool, createSdkMcpServer, type SDKMessage, type SDKUserMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import cliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { z } from "zod/v4";
import { createInterface } from "readline";
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from "fs";
import { join, basename, relative } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

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
interface ReplyPayload {
  content: string;
  updatedInput?: Record<string, unknown>;
}
let pendingApproval: ((answer: ReplyPayload) => void) | null = null;
let pendingReply: ReplyPayload | null = null;

// Persistent session state
let activeStream: MessageStream | null = null;
let activeAbort: AbortController | null = null;
let activeSessionConfig: { projectPath: string; sessionId?: string } | null = null;
let sessionAlive: boolean = false;
let knownSessionId: string | null = null;
let currentCardId: string | null = null;
let isShuttingDown = false;

// ---- async message queue for persistent sessions ----
// Single-consumer queue: the SDK's streamInput loop is the only consumer.
// Messages are enqueued from stdin commands and pulled by the SDK at its own pace.
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waitResolve: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private isDone: boolean = false;

  enqueue(msg: SDKUserMessage): void {
    if (this.isDone) return;
    if (this.waitResolve) {
      const r = this.waitResolve;
      this.waitResolve = null;
      r({ done: false, value: msg });
    } else {
      this.queue.push(msg);
    }
  }

  finish(): void {
    this.isDone = true;
    if (this.waitResolve) {
      const r = this.waitResolve;
      this.waitResolve = null;
      r({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return this;
  }

  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ done: false, value: this.queue.shift()! });
    }
    if (this.isDone) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => { this.waitResolve = resolve; });
  }
}

// ---- build SDK user message from stdin command data ----
function buildUserMessage(
  prompt: string,
  imagePaths?: { path: string; mediaType: string }[],
  sessionId?: string,
): SDKUserMessage {
  const content: Record<string, unknown>[] = [];

  if (imagePaths?.length) {
    for (const img of imagePaths) {
      try {
        const data = readFileSync(img.path, "base64");
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data },
        });
        try { unlinkSync(img.path); } catch { /* ignore */ }
      } catch (err) {
        process.stderr.write(`[agent-bridge] failed to read image ${img.path}: ${err}\n`);
      }
    }
  }

  content.push({ type: "text", text: prompt });

  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId || "",
  } as unknown as SDKUserMessage;
}

// ---- pending session requests (MCP tools → frontend) ----
const pendingSessionRequests = new Map<string, (data: Record<string, unknown>) => void>();

function requestFromFrontend(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  emit({ type: "session_request", requestId, action, ...payload });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSessionRequests.delete(requestId);
      reject(new Error(`Frontend request "${action}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingSessionRequests.set(requestId, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ---- OnCraft MCP tools ----
const oncraftTools = [
  tool(
    "get_current_card",
    "Get all fields of the current OnCraft card/session. Use this to know the card's current name, description, column, state, tags, and linked files.",
    {},
    async (_args) => {
      const data = await requestFromFrontend("get_current_card");
      return { content: [{ type: "text" as const, text: JSON.stringify(data.card) }] };
    },
  ),
  tool(
    "update_current_card",
    "Update fields of the current OnCraft card. Only provide the fields you want to change. Protected fields (id, sessionId, projectId, etc.) are ignored.",
    {
      name: z.string().optional().describe("Card title"),
      description: z.string().optional().describe("Card description"),
      columnName: z.string().optional().describe("Target column name to move the card to"),
      state: z.enum(["active", "idle", "error", "completed"]).optional().describe("Card state"),
      tags: z.array(z.string()).optional().describe("Tag list"),
      archived: z.boolean().optional().describe("Archive or unarchive the card"),
      linkedFiles: z.record(z.string(), z.string()).optional().describe('Files linked to this card as { label: relativePath }. Merged with existing entries. Set a label to "" to remove it. e.g. { "plan": "docs/plan.md" }'),
      linkedIssues: z.array(z.object({ number: z.number(), title: z.string().optional() })).optional().describe("GitHub issues linked to this card"),
    },
    async (args) => {
      const data = await requestFromFrontend("update_current_card", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    },
  ),
  tool(
    "get_project",
    "Get info about the current OnCraft project: name, path, and available columns. Useful to know which columns exist before moving a card.",
    {},
    async (_args) => {
      const data = await requestFromFrontend("get_project");
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    },
  ),
];

const oncraftMcpServer = createSdkMcpServer({
  name: "oncraft",
  version: "1.0.0",
  tools: oncraftTools,
});

// ---- message translation ----
function translateMessage(
  msg: SDKMessage,
): Record<string, unknown> | Record<string, unknown>[] | null {
  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (!content || !Array.isArray(content)) return null;
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;

    const results: Record<string, unknown>[] = [];
    for (const block of content) {
      if (block.type === "text") {
        results.push({
          type: "assistant",
          content: block.text,
          parentToolUseId,
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
          parentToolUseId,
        });
      } else if (block.type === "thinking") {
        results.push({
          type: "assistant",
          content: (block as { thinking?: string }).thinking || "",
          subtype: "thinking",
          parentToolUseId,
        });
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }

  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!content) return null;
    const isSynthetic = (msg as Record<string, unknown>).isSynthetic === true;
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;

    // Content can be a plain string
    if (typeof content === "string") {
      return { type: "user", content, isSynthetic, parentToolUseId };
    }

    if (!Array.isArray(content)) return null;

    const results: Record<string, unknown>[] = [];
    const images: { data: string; mediaType: string; name: string }[] = [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "text") {
        results.push({ type: "user", content: block.text, isSynthetic, parentToolUseId });
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
          parentToolUseId,
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
    if (subtype === "api_retry") {
      return {
        type: "api_retry",
        attempt: sysMsg.attempt,
        maxRetries: sysMsg.max_retries,
        retryDelayMs: sysMsg.retry_delay_ms,
        errorStatus: sysMsg.error_status,
      };
    }
    if (subtype === "session_state_changed") {
      return {
        type: "session_state_changed",
        state: sysMsg.state,
      };
    }
    // For any other system subtype, keep the existing generic handler:
    return {
      type: "system",
      subtype: sysMsg.subtype || "unknown",
      content: sysMsg.message || sysMsg.subtype || "",
    };
  }

  // Streaming partial messages (token-by-token text and thinking)
  if (msg.type === "stream_event") {
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;
    const event = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return {
          type: "assistant",
          subtype: "streaming",
          content: delta.text,
          parentToolUseId,
        };
      }
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        return {
          type: "assistant",
          subtype: "thinking_streaming",
          content: delta.thinking,
          parentToolUseId,
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
      parentToolUseId: m.parent_tool_use_id ?? null,
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

// ---- persistent session loop ----
// Runs in background (not awaited) for the lifetime of the card session.
// The for-await loop consumes messages from the SDK as they arrive.
// It exits when the MessageStream finishes or an error/abort occurs.
async function runSession(
  stream: MessageStream,
  options: Record<string, unknown>,
): Promise<void> {
  sessionAlive = true;
  try {
    const conversation = query({ prompt: stream as any, options });
    for await (const message of conversation) {
      // Capture session ID from init message
      if (message.type === "system") {
        const sysMsg = message as Record<string, unknown>;
        if (sysMsg.subtype === "init" && sysMsg.session_id) {
          knownSessionId = sysMsg.session_id as string;
        }
      }

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
    process.stderr.write(`[agent-bridge] session error: ${String(err)}\n`);
    process.stderr.write(`[agent-bridge] error stack: ${(err as Error).stack || "no stack"}\n`);
    if ((err as Error).name === "AbortError") {
      emit({
        type: "system",
        subtype: "interrupted",
        content: "Query interrupted",
      });
    } else {
      emitError(String(err));
      emit({ type: "system", subtype: "session_died", content: String(err) });
    }
  } finally {
    sessionAlive = false;
    activeStream = null;
    activeAbort = null;
    activeSessionConfig = null;
    knownSessionId = null;
  }
}

function buildAllowedTools(
  allowedTools: string[] | undefined,
  extraMcpServers: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!allowedTools?.length) return allowedTools;
  const merged = new Set(allowedTools);
  // Keep bridge MCP tools explicitly available when a strict allowlist is provided
  merged.add("mcp__oncraft__get_current_card");
  merged.add("mcp__oncraft__update_current_card");
  merged.add("mcp__oncraft__get_project");
  // If extra MCP servers are enabled, keep explicit server prefixes opt-in ready
  for (const key of Object.keys(extraMcpServers || {})) {
    merged.add(`mcp__${key}__*`);
  }
  return Array.from(merged);
}

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (pendingApproval) {
    pendingApproval({ content: "deny" });
    pendingApproval = null;
  }
  pendingReply = null;

  if (activeStream) activeStream.finish();
  if (activeAbort) activeAbort.abort();

  setTimeout(() => process.exit(0), 200).unref?.();
}

// Warm the embedded CLI once at startup to reduce first-query latency
void startup({
  pathToClaudeCodeExecutable: cliPath,
  executable: "node",
  env: claudeEnv,
}).catch((err) => {
  process.stderr.write(`[agent-bridge] startup prewarm failed: ${String(err)}\n`);
});

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

  // Handle session_response from frontend (MCP tool replies)
  if (cmd.cmd === "session_response") {
    const resolver = pendingSessionRequests.get(cmd.requestId as string);
    if (resolver) {
      resolver(cmd.data as Record<string, unknown>);
      pendingSessionRequests.delete(cmd.requestId as string);
    }
    return;
  }

  // Handle reply to pending tool approval
  if (cmd.cmd === "reply") {
    const payload: ReplyPayload = {
      content: cmd.content as string,
      updatedInput: cmd.updatedInput as Record<string, unknown> | undefined,
    };
    if (pendingApproval) {
      pendingApproval(payload);
      pendingApproval = null;
    } else if (!pendingReply) {
      process.stderr.write("[agent-bridge] reply arrived before pendingApproval — buffering\n");
      pendingReply = payload;
    } else {
      process.stderr.write("[agent-bridge] warning: duplicate reply while buffer occupied — ignoring\n");
    }
    return;
  }

  // Handle interrupt — kill the persistent session, allow fresh start
  if (cmd.cmd === "interrupt") {
    if (activeAbort) {
      // Set sessionAlive=false synchronously BEFORE aborting to prevent
      // race condition where a cmd:start arrives before runSession's
      // finally block executes.
      sessionAlive = false;
      const abort = activeAbort;
      activeStream = null;
      activeAbort = null;
      activeSessionConfig = null;
      knownSessionId = null;
      pendingReply = null;
      abort.abort();
    }
    return;
  }

  // Handle stop — clean shutdown of persistent session
  if (cmd.cmd === "stop") {
    await gracefulShutdown();
    return;
  }

  // Handle start — create or reuse persistent session
  if (cmd.cmd === "start") {
    const projectPath = cmd.projectPath as string;
    const imagePaths = cmd.imagePaths as { path: string; mediaType: string }[] | undefined;
    currentCardId = (cmd.cardId as string) || null;

    if (sessionAlive && activeStream && activeSessionConfig) {
      // Active session exists — enqueue a new user message
      if (activeSessionConfig.projectPath !== projectPath) {
        process.stderr.write(`[agent-bridge] projectPath mismatch: active=${activeSessionConfig.projectPath}, requested=${projectPath}\n`);
        emitError("Cannot change project path within an active session");
        return;
      }
      process.stderr.write(`[agent-bridge] enqueueing message into active session\n`);
      const userMsg = buildUserMessage(
        cmd.prompt as string,
        imagePaths,
        knownSessionId || undefined,
      );
      activeStream.enqueue(userMsg);
      return;
    }

    // No active session — create a new persistent session
    process.stderr.write(`[agent-bridge] starting persistent session, cwd=${projectPath}, cardId=${currentCardId}\n`);

    const stream = new MessageStream();
    const abort = new AbortController();

    activeStream = stream;
    activeAbort = abort;
    activeSessionConfig = {
      projectPath,
      sessionId: cmd.sessionId as string | undefined,
    };

    // Build and enqueue the first user message
    const userMsg = buildUserMessage(
      cmd.prompt as string,
      imagePaths,
    );
    stream.enqueue(userMsg);

    // Flow-injected fields (from useFlowStore resolution in the frontend)
    const systemPromptAppend = cmd.systemPromptAppend as string | undefined;
    const allowedTools       = cmd.allowedTools    as string[] | undefined;
    const disallowedTools    = cmd.disallowedTools as string[] | undefined;
    const agents             = cmd.agents          as Record<string, unknown> | undefined;
    const extraMcpServers    = cmd.mcpServers      as Record<string, unknown> | undefined;

    const policyAllowedTools = buildAllowedTools(allowedTools, extraMcpServers);

    // Build query options (same as before, but bound once per session)
    const queryOptions = {
      pathToClaudeCodeExecutable: cliPath,
      executable: "node",
      env: claudeEnv,
      cwd: projectPath,
      stderr: (data: string) => {
        process.stderr.write(`[agent-bridge] CLI stderr: ${data}`);
      },
      resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
      forkSession: cmd.forkSession ? true : undefined,
      abortController: abort,
      model: (cmd.model as string) || undefined,
      effort: (cmd.effort as string) || undefined,
      permissionMode: (cmd.permissionMode as string) || "default",
      settingSources: ["user", "project"],
      includePartialMessages: true,
      mcpServers: {
        oncraft: oncraftMcpServer,
        ...(extraMcpServers || {}),
      },
      ...(systemPromptAppend ? {
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: systemPromptAppend,
        },
      } : {}),
      ...(policyAllowedTools?.length ? { allowedTools: policyAllowedTools } : {}),
      ...(disallowedTools?.length ? { disallowedTools } : {}),
      ...(agents && Object.keys(agents).length ? { agents } : {}),
      hooks: {
        session_end: async (event: Record<string, unknown>) => {
          emit({
            type: "system",
            subtype: "session_end",
            terminal_reason: event?.terminal_reason || null,
          });
        },
      },
      ...(cmd.worktreeName ? {
        extraArgs: { worktree: cmd.worktreeName as string },
      } : {}),
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        options: {
          signal: AbortSignal;
          toolUseID: string;
          title?: string;
          displayName?: string;
          description?: string;
        },
      ): Promise<PermissionResult> => {
        const reply = await new Promise<ReplyPayload>((resolve) => {
          // If already aborted before we even start, deny immediately
          if (options.signal.aborted) {
            resolve({ content: "deny" });
            return;
          }

          pendingApproval = resolve;

          // Auto-deny if the SDK aborts (e.g. user interrupted)
          const onAbort = () => {
            if (pendingApproval) {
              pendingApproval({ content: "deny" });
              pendingApproval = null;
            }
          };
          options.signal.addEventListener("abort", onAbort, { once: true });

          // Drain buffered reply if one arrived before this callback
          if (pendingReply) {
            const buffered = pendingReply;
            pendingReply = null;
            pendingApproval = null;
            options.signal.removeEventListener("abort", onAbort);
            resolve(buffered);
            return;
          }
          // Only emit after pendingApproval is assigned
          emit({
            type: "tool_confirmation",
            toolName,
            toolInput: input,
            toolUseId: options.toolUseID,
            ...(options.title ? { title: options.title } : {}),
            ...(options.displayName ? { displayName: options.displayName } : {}),
            ...(options.description ? { description: options.description } : {}),
          });
        });
        if (reply.content === "allow") {
          return {
            behavior: "allow" as const,
            updatedInput: reply.updatedInput ?? input,
            decisionClassification: "user_temporary" as const,
          };
        }
        return {
          behavior: "deny" as const,
          message: "User denied",
          decisionClassification: "user_reject" as const,
        };
      },
    };

    // Launch session in background — do not await
    runSession(stream, queryOptions);
    return;
  }

  // Handle loadHistory
  if (cmd.cmd === "loadHistory") {
    try {
      const sessionId = cmd.sessionId as string;
      process.stderr.write(`[agent-bridge] loading history for session ${sessionId}\n`);
      let history: unknown[] = [];
      try {
        history = await getSessionMessages(sessionId, { includeSystemMessages: true } as Record<string, unknown>);
      } catch {
        // Backward compatibility with SDK versions that don't support options
        history = await getSessionMessages(sessionId);
      }
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

  // listCommands: superseded by native Rust implementation (commands.rs list_commands)

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

  // deleteSession: superseded by native Rust implementation (commands.rs delete_session)

  emitError(`Unknown command: ${cmd.cmd}`);
});

// Handle stdin close (Tauri killed us) — clean up persistent session
rl.on("close", () => {
  void gracefulShutdown();
});
