/**
 * @module ACPBridge
 * @description
 * Expose Veridex agents as ACP-compatible agents and consume
 * ACP agents as remote collaborators.
 *
 * ACP (Agent Communication Protocol) defines a standard for
 * agent-to-agent communication through capability cards and
 * typed invocation requests.
 */

import type { AgentDefinition, ToolContract, ToolSafetyClass } from '@veridex/agents';
import type {
  ACPAgentCard,
  ACPCapability,
  ACPInvocationRequest,
  ACPInvocationResponse,
  RemoteAgentConfig,
} from './types';

// ── Export: Veridex → ACP ──

/**
 * Generate an ACP agent card from a Veridex AgentDefinition.
 * Exposes the agent's tools as ACP capabilities.
 */
export function toACPAgentCard(
  definition: AgentDefinition,
  options?: { endpoint?: string; version?: string },
): ACPAgentCard {
  const capabilities: ACPCapability[] = (definition.tools ?? []).map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalizeSchema(tool.input),
      outputSchema: tool.output ? normalizeSchema(tool.output) : undefined,
      tags: [tool.safetyClass],
    }),
  );

  return {
    name: definition.name,
    description: definition.instructions.slice(0, 500),
    version: options?.version ?? '0.1.0',
    capabilities,
    endpoint: options?.endpoint,
    metadata: {
      veridexAgentId: definition.id,
      model: definition.model,
    },
  };
}

/**
 * Normalize a schema (Zod or JSON Schema) to JSON Schema for ACP export.
 * If it looks like a Zod schema (has _def), attempt basic conversion.
 * Otherwise pass through as-is.
 */
function normalizeSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  if (typeof schema === 'object' && schema !== null) {
    // If it has 'type' it's likely already JSON Schema
    if ('type' in schema) return schema as Record<string, unknown>;
    // If it has '_def' it's a Zod schema — return a generic object schema
    if ('_def' in schema) return { type: 'object' };
  }
  return { type: 'object' };
}

// ── Import: ACP → Veridex ──

/**
 * Convert ACP capabilities into Veridex ToolContracts.
 * Creates stub executors that delegate to the remote ACP endpoint.
 */
export function fromACPCapabilities(
  capabilities: ACPCapability[],
  remote: RemoteAgentConfig,
): ToolContract[] {
  return capabilities.map((cap) => ({
    name: cap.name,
    description: cap.description,
    input: cap.inputSchema ?? { type: 'object', properties: {} },
    output: cap.outputSchema,
    safetyClass: inferSafetyFromTags(cap.tags),
    execute: createACPExecutor(cap.name, remote),
    timeoutMs: remote.timeoutMs ?? 30_000,
    idempotent: false,
  }));
}

/**
 * Infer a safety class from ACP capability tags.
 */
function inferSafetyFromTags(tags?: string[]): ToolSafetyClass {
  if (!tags || tags.length === 0) return 'network';
  const joined = tags.join(' ').toLowerCase();
  if (joined.includes('financial')) return 'financial';
  if (joined.includes('destructive')) return 'destructive';
  if (joined.includes('privileged')) return 'privileged';
  if (joined.includes('write')) return 'write';
  if (joined.includes('read')) return 'read';
  return 'network';
}

async function invokeRemoteACP(
  remote: RemoteAgentConfig,
  request: ACPInvocationRequest,
  signal?: AbortSignal,
): Promise<ACPInvocationResponse> {
  if (remote.invoker) {
    return remote.invoker.invoke(request, signal);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (remote.auth?.type === 'bearer' && remote.auth.token) {
    headers.Authorization = `Bearer ${remote.auth.token}`;
  } else if (remote.auth?.type === 'api-key' && remote.auth.token) {
    headers[remote.auth.headerName ?? 'X-API-Key'] = remote.auth.token;
  }

  const response = await fetch(remote.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  });

  let result: ACPInvocationResponse | undefined;
  try {
    result = (await response.json()) as ACPInvocationResponse;
  } catch {
    result = undefined;
  }

  if (!response.ok) {
    return {
      success: false,
      error: result?.error ?? `ACP endpoint returned ${response.status}`,
      metadata: result?.metadata,
      output: result?.output,
    };
  }

  return result ?? {
    success: false,
    error: 'ACP endpoint returned an empty response body',
  };
}

/**
 * Create a tool executor that invokes an ACP capability on a remote agent.
 */
function createACPExecutor(
  capabilityName: string,
  remote: RemoteAgentConfig,
) {
  return async (params: { input: unknown }): Promise<{
    llmOutput: string;
    success: boolean;
    error?: string;
  }> => {
    const request: ACPInvocationRequest = {
      capability: capabilityName,
      input: params.input as Record<string, unknown>,
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      remote.timeoutMs ?? 30_000,
    );

    try {
      const result = await invokeRemoteACP(remote, request, controller.signal);

      if (!result.success) {
        return {
          llmOutput: '',
          success: false,
          error: result.error ?? 'ACP invocation failed',
        };
      }

      return {
        llmOutput: typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output),
        success: true,
      };
    } catch (err) {
      return {
        llmOutput: '',
        success: false,
        error: err instanceof Error ? err.message : 'ACP invocation failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

// ── Remote Agent Adapter ──

/**
 * Create a Veridex ToolContract that delegates to a remote OpenClaw/ACP agent.
 * The tool takes a "prompt" input and returns the remote agent's response.
 */
export function createRemoteAgentTool(
  remote: RemoteAgentConfig,
): ToolContract {
  return {
    name: `remote_${remote.name.toLowerCase().replace(/\s+/g, '_')}`,
    description: `Invoke remote agent "${remote.name}": ${remote.description}`,
    input: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to send to the remote agent' },
        capability: { type: 'string', description: 'Specific capability to invoke (optional)' },
      },
      required: ['prompt'],
    },
    safetyClass: 'network',
    execute: async (params: { input: unknown }) => {
      const { prompt, capability } = params.input as {
        prompt: string;
        capability?: string;
      };

      const request: ACPInvocationRequest = {
        capability: capability ?? 'default',
        input: { prompt },
      };

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        remote.timeoutMs ?? 30_000,
      );

      try {
        const result = await invokeRemoteACP(remote, request, controller.signal);

        return {
          llmOutput: result.success
            ? (typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output))
            : '',
          success: result.success,
          error: result.success ? undefined : (result.error ?? 'Remote agent invocation failed'),
        };
      } catch (err) {
        return {
          llmOutput: '',
          success: false,
          error: err instanceof Error ? err.message : 'Remote agent invocation failed',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    timeoutMs: remote.timeoutMs ?? 30_000,
    idempotent: false,
  };
}
