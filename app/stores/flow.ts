import type { Flow, FlowState, FlowWarning } from '~/types';
import { loadFlow, resolveConfigForState, type LoadFlowResult } from '~/services/flow-loader';
import { resolveAgents, type ResolvedAgent } from '~/services/agent-resolver';
import type { McpServerConfig, AgentConfig } from '~/types';

export interface ResolvedFlowConfig {
  agent: AgentConfig;
  agents: ResolvedAgent[];
  agentsMissing: string[];
  skills: string[];
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  disallowedTools: string[];
  systemPromptAppend: string;
}

export const useFlowStore = defineStore('flow', () => {
  const flow     = ref<Flow | null>(null);
  const flowMd   = ref<string>('');
  const warnings = ref<FlowWarning[]>([]);
  const loaded   = ref<string | null>(null); // projectPath currently loaded

  async function loadForProject(projectPath: string): Promise<void> {
    try {
      const result: LoadFlowResult = await loadFlow(projectPath);
      flow.value     = result.flow;
      flowMd.value   = result.flowMd;
      warnings.value = result.warnings;
      loaded.value   = projectPath;
      if (import.meta.dev) {
        console.log('[OnCraft] Flow loaded:', result.flow.name, result.flow.stateOrder.length, 'states');
        if (result.warnings.length) console.warn('[OnCraft] Flow warnings:', result.warnings);
      }
    } catch (err) {
      if (import.meta.dev) console.error('[OnCraft] Failed to load flow:', err);
      warnings.value = [{ scope: 'flow', message: `Failed to load flow: ${err}` }];
    }
  }

  function getFlowState(slug: string): FlowState | undefined {
    return flow.value?.states.find(s => s.slug === slug);
  }

  const stateOrder = computed(() => flow.value?.stateOrder ?? []);

  const flowWarnings = computed(() =>
    warnings.value.filter(w => w.scope === 'flow')
  );

  function stateWarnings(slug: string): FlowWarning[] {
    return warnings.value.filter(w => w.scope === 'state' && w.stateSlug === slug);
  }

  // Resolve full config for a card in a given state (Flow + FlowState layers).
  // Named getResolvedConfig to avoid collision with imported resolveConfigForState.
  // Card-level overrides (model, effort, permissionMode) are applied by sessions.ts on top.
  async function getResolvedConfig(
    stateSlug: string,
    projectPath: string,
  ): Promise<ResolvedFlowConfig | null> {
    if (!flow.value) return null;

    const config = resolveConfigForState(flow.value, stateSlug, flowMd.value);

    // Resolve agent names → AgentDefinition objects
    const { resolved, missing } = await resolveAgents(config.agents, projectPath);

    // Add warnings for missing agents
    for (const name of missing) {
      const alreadyWarned = warnings.value.some(
        w => w.stateSlug === stateSlug && w.message.includes(name)
      );
      if (!alreadyWarned) {
        warnings.value.push({
          scope:     stateSlug ? 'state' : 'flow',
          stateSlug: stateSlug || undefined,
          message:   `Agent "${name}" not found in .claude/agents/ or plugins`,
        });
      }
    }

    return {
      agent:         config.agent,
      agents:        Object.values(resolved),
      agentsMissing: missing,
      skills:        config.skills,
      mcpServers:    config.mcpServers,
      allowedTools:  config.allowedTools,
      disallowedTools: config.disallowedTools,
      systemPromptAppend: config.systemPromptAppend,
    };
  }

  function getTriggerPrompt(slug: string): string | undefined {
    return getFlowState(slug)?.triggerPrompt;
  }

  // Check requiredFiles precondition for a card move
  // Returns array of missing slot names (empty = OK to proceed)
  function checkRequiredFiles(
    stateSlug: string,
    cardLinkedFiles: Record<string, string> | undefined,
  ): string[] {
    const state = getFlowState(stateSlug);
    if (!state?.requiredFiles?.length) return [];
    const files = cardLinkedFiles || {};
    return state.requiredFiles.filter(slot => !files[slot] || !files[slot].trim());
  }

  function reset(): void {
    flow.value     = null;
    flowMd.value   = '';
    warnings.value = [];
    loaded.value   = null;
  }

  return {
    flow, flowMd, warnings, loaded, stateOrder, flowWarnings,
    loadForProject, getFlowState, stateWarnings,
    getResolvedConfig, getTriggerPrompt, checkRequiredFiles, reset,
  };
});
