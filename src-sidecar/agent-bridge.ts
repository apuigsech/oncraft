import { query, type SDKMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline";

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
    if (!content || !Array.isArray(content)) return null;

    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
        };
      }
    }
    return null;
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
    if (sysMsg.subtype === "init") {
      return {
        type: "system",
        subtype: "init",
        sessionId: sysMsg.session_id,
      };
    }
    return {
      type: "system",
      subtype: sysMsg.subtype || "unknown",
      content: sysMsg.message || sysMsg.subtype || "",
    };
  }

  // Pass through unknown types as system messages
  return {
    type: "system",
    subtype: (msg as Record<string, unknown>).type as string,
    content: JSON.stringify(msg),
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
    process.stderr.write(`[agent-bridge] starting query, cwd=${cmd.projectPath}, prompt=${(cmd.prompt as string).substring(0, 50)}\n`);

    try {
      const conversation = query({
        prompt: cmd.prompt as string,
        options: {
          cwd: cmd.projectPath as string,
          resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
          abortController: currentAbort,
          permissionMode: "default",
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
      process.stderr.write(`[agent-bridge] error: ${err}\n`);
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

  emitError(`Unknown command: ${cmd.cmd}`);
});

// Handle stdin close (Tauri killed us)
rl.on("close", () => {
  process.exit(0);
});
