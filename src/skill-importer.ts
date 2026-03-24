/**
 * @module SkillImporter
 * @description
 * Convert OpenClaw skill definitions into Veridex ToolContract objects.
 *
 * OpenClaw skills have their own schema format with tags, mutation flags,
 * approval requirements, and timeouts. This importer maps them into the
 * Veridex ToolContract format with appropriate safety class inference.
 */

import type { ToolContract, ToolSafetyClass } from '@veridex/agents';
import type { OpenClawSkill, SkillManifest } from './types';

// ── Safety Class Inference ──

/**
 * Infer a Veridex ToolSafetyClass from an OpenClaw skill definition.
 *
 * Heuristics:
 * - requiresApproval → 'privileged'
 * - mutates && requiresNetwork → 'network'
 * - mutates → 'write'
 * - requiresNetwork → 'network'
 * - tags containing financial keywords → 'financial'
 * - tags containing destructive keywords → 'destructive'
 * - default → 'read'
 */
export function inferSafetyClassFromSkill(skill: OpenClawSkill): ToolSafetyClass {
  const tags = (skill.tags ?? []).map(t => t.toLowerCase());

  if (skill.requiresApproval) return 'privileged';

  const financialKeywords = ['payment', 'transfer', 'fund', 'billing', 'invoice', 'money', 'wallet'];
  if (tags.some(t => financialKeywords.some(k => t.includes(k)))) return 'financial';

  const destructiveKeywords = ['delete', 'destroy', 'remove', 'drop', 'purge', 'wipe'];
  if (tags.some(t => destructiveKeywords.some(k => t.includes(k)))) return 'destructive';

  if (skill.mutates && skill.requiresNetwork) return 'network';
  if (skill.mutates) return 'write';
  if (skill.requiresNetwork) return 'network';

  return 'read';
}

// ── Stub Executor ──

function createSkillStubExecutor(skillId: string) {
  return async (): Promise<{
    llmOutput: string;
    success: boolean;
  }> => ({
    llmOutput: `[stub] Skill "${skillId}" imported from OpenClaw — executor not bound`,
    success: true,
  });
}

// ── Skill → ToolContract ──

/** Result of importing a single skill. */
export interface SkillImportResult {
  /** The converted ToolContract */
  tool: ToolContract;
  /** Warnings generated during conversion */
  warnings: string[];
}

/**
 * Convert a single OpenClaw skill into a Veridex ToolContract.
 */
export function importSkill(skill: OpenClawSkill): SkillImportResult {
  const warnings: string[] = [];

  if (!skill.description) {
    warnings.push(`Skill "${skill.id}" has no description — model may struggle to use it`);
  }

  const safetyClass = inferSafetyClassFromSkill(skill);

  const tool: ToolContract = {
    name: skill.name || skill.id,
    description: skill.description ?? `OpenClaw skill: ${skill.id}`,
    input: skill.inputSchema ?? { type: 'object', properties: {} },
    safetyClass,
    execute: createSkillStubExecutor(skill.id),
    timeoutMs: skill.timeoutSeconds ? skill.timeoutSeconds * 1000 : 30_000,
    idempotent: !skill.mutates,
    permissions: skill.requiresApproval ? ['approval_required'] : undefined,
    ...(skill.outputSchema ? { output: skill.outputSchema } : {}),
  };

  if (skill.metadata) {
    warnings.push(
      `Skill "${skill.id}" has custom metadata that was preserved in tool metadata`,
    );
    (tool as ToolContract & { metadata?: Record<string, unknown> }).metadata = {
      ...skill.metadata,
      openClawTags: skill.tags,
      openClawId: skill.id,
    };
  }

  return { tool, warnings };
}

// ── Manifest Import ──

/** Result of importing a full skill manifest. */
export interface ManifestImportResult {
  /** Converted ToolContracts */
  tools: ToolContract[];
  /** All warnings across all skills */
  warnings: string[];
  /** Source agent ID from the manifest */
  sourceAgentId?: string;
}

/**
 * Import an entire OpenClaw skill manifest into Veridex ToolContracts.
 */
export function importSkillManifest(manifest: SkillManifest): ManifestImportResult {
  const tools: ToolContract[] = [];
  const warnings: string[] = [];

  if (manifest.version) {
    warnings.push(`OpenClaw manifest version: ${manifest.version}`);
  }

  for (const skill of manifest.skills) {
    const result = importSkill(skill);
    tools.push(result.tool);
    warnings.push(...result.warnings);
  }

  return {
    tools,
    warnings,
    sourceAgentId: manifest.agentId,
  };
}
