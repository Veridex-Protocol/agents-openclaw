/**
 * @module SkillImporter
 * @description
 * Convert OpenClaw skills into Veridex ToolContract objects.
 *
 * Supports both:
 * - serialized skill manifests (interop/export format)
 * - docs-native `SKILL.md` files with YAML frontmatter
 *
 * OpenClaw skills are primarily instruction bundles, not standalone executors,
 * so imported skills default to a fail-closed executor unless the caller binds
 * them to a real remote ACP endpoint or supplies a concrete executor.
 */

import { parse as parseYaml } from 'yaml';
import type { ToolContract, ToolSafetyClass } from '@veridex/agents';
import type {
  OpenClawSkill,
  OpenClawSkillDocument,
  OpenClawSkillFrontmatter,
  RemoteAgentConfig,
  SkillManifest,
} from './types';
import { fromACPCapabilities } from './acp-bridge';

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
  const tags = (skill.tags ?? []).map((tag) => tag.toLowerCase());

  if (skill.requiresApproval) return 'privileged';

  const financialKeywords = ['payment', 'transfer', 'fund', 'billing', 'invoice', 'money', 'wallet'];
  if (tags.some((tag) => financialKeywords.some((keyword) => tag.includes(keyword)))) {
    return 'financial';
  }

  const destructiveKeywords = ['delete', 'destroy', 'remove', 'drop', 'purge', 'wipe'];
  if (tags.some((tag) => destructiveKeywords.some((keyword) => tag.includes(keyword)))) {
    return 'destructive';
  }

  if (skill.mutates && skill.requiresNetwork) return 'network';
  if (skill.mutates) return 'write';
  if (skill.requiresNetwork) return 'network';

  return 'read';
}

// ── Executor Binding ──

export interface SkillImportOptions {
  /** Concrete executor to bind to the imported tool. */
  executor?: ToolContract['execute'];
  /** Remote ACP/OpenClaw collaborator to bind to the imported tool. */
  remote?: RemoteAgentConfig;
}

function createUnboundSkillExecutor(skillId: string) {
  return async (): Promise<{
    llmOutput: string;
    success: boolean;
    error: string;
  }> => ({
    llmOutput: '',
    success: false,
    error: `Skill "${skillId}" was imported from OpenClaw but has no bound executor or remote ACP transport.`,
  });
}

function resolveSkillExecutor(
  skill: OpenClawSkill,
  options?: SkillImportOptions,
): ToolContract['execute'] {
  if (options?.executor) {
    return options.executor;
  }

  if (options?.remote) {
    const [boundTool] = fromACPCapabilities(
      [{
        name: skill.name || skill.id,
        description: skill.description ?? `OpenClaw skill: ${skill.id}`,
        inputSchema: skill.inputSchema ?? defaultSkillPromptSchema(),
        outputSchema: skill.outputSchema,
        tags: skill.tags,
      }],
      options.remote,
    );
    return boundTool.execute;
  }

  return createUnboundSkillExecutor(skill.id);
}

function defaultSkillPromptSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Prompt or task to execute using this imported OpenClaw skill',
      },
    },
    required: ['prompt'],
  };
}

// ── SKILL.md Parsing ──

function slugifyName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'openclaw_skill';
}

function summarizeInstructions(markdown: string): string {
  const summary = markdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));

  if (!summary) return 'Imported OpenClaw skill';
  return summary.slice(0, 160);
}

function normalizeSkillTool(raw: unknown): OpenClawSkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string'
    ? candidate.id
    : typeof candidate.name === 'string'
      ? candidate.name
      : undefined;
  const name = typeof candidate.name === 'string' ? candidate.name : id;

  if (!id || !name) return null;

  return {
    id,
    name,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    inputSchema: isRecord(candidate.inputSchema) ? candidate.inputSchema : undefined,
    outputSchema: isRecord(candidate.outputSchema) ? candidate.outputSchema : undefined,
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((value): value is string => typeof value === 'string')
      : undefined,
    mutates: typeof candidate.mutates === 'boolean' ? candidate.mutates : undefined,
    requiresNetwork: typeof candidate.requiresNetwork === 'boolean' ? candidate.requiresNetwork : undefined,
    requiresApproval: typeof candidate.requiresApproval === 'boolean' ? candidate.requiresApproval : undefined,
    timeoutSeconds: typeof candidate.timeoutSeconds === 'number' ? candidate.timeoutSeconds : undefined,
    metadata: isRecord(candidate.metadata) ? candidate.metadata : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFrontmatter(
  raw: unknown,
  filename: string,
  instructions: string,
): OpenClawSkillFrontmatter {
  const record = isRecord(raw) ? raw : {};
  const name = typeof record.name === 'string' ? record.name : slugifyName(filename);
  const description = typeof record.description === 'string'
    ? record.description
    : summarizeInstructions(instructions);
  const tools = Array.isArray(record.tools)
    ? record.tools.map(normalizeSkillTool).filter((tool): tool is OpenClawSkill => tool !== null)
    : undefined;

  return {
    ...record,
    name,
    description,
    metadata: isRecord(record.metadata) ? record.metadata as OpenClawSkillFrontmatter['metadata'] : undefined,
    tools,
  };
}

/**
 * Parse a docs-native OpenClaw `SKILL.md` file into structured data.
 */
export function parseSkillDocument(
  content: string,
  filename = 'SKILL.md',
): OpenClawSkillDocument {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    const instructions = content.trim();
    return {
      filename,
      raw: content,
      frontmatter: normalizeFrontmatter({}, filename, instructions),
      instructions,
    };
  }

  const [, frontmatterBlock, markdownBody] = match;
  const instructions = markdownBody.trim();
  const parsedFrontmatter = parseYaml(frontmatterBlock) as unknown;

  return {
    filename,
    raw: content,
    frontmatter: normalizeFrontmatter(parsedFrontmatter, filename, instructions),
    instructions,
  };
}

function documentToSkill(document: OpenClawSkillDocument): OpenClawSkill {
  const inlineTool = document.frontmatter.tools?.[0];
  const descriptionSuffix = document.instructions
    ? `\n\nSkill instructions:\n${document.instructions}`
    : '';

  return {
    id: document.frontmatter.name,
    name: document.frontmatter.name,
    description: `${document.frontmatter.description}${descriptionSuffix}`.trim(),
    inputSchema: inlineTool?.inputSchema ?? defaultSkillPromptSchema(),
    outputSchema: inlineTool?.outputSchema,
    tags: inlineTool?.tags,
    mutates: inlineTool?.mutates,
    requiresNetwork: inlineTool?.requiresNetwork ?? true,
    requiresApproval: inlineTool?.requiresApproval,
    timeoutSeconds: inlineTool?.timeoutSeconds,
    metadata: {
      ...(document.frontmatter.metadata ?? {}),
      openClawSkillFilename: document.filename,
      openClawSkillInstructions: document.instructions,
      openClawEmbeddedToolCount: document.frontmatter.tools?.length ?? 0,
    },
  };
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
export function importSkill(
  skill: OpenClawSkill,
  options?: SkillImportOptions,
): SkillImportResult {
  const warnings: string[] = [];

  if (!skill.description) {
    warnings.push(`Skill "${skill.id}" has no description — model may struggle to use it`);
  }

  if (!options?.executor && !options?.remote) {
    warnings.push(
      `Skill "${skill.id}" was imported without a bound executor; bind a remote ACP invoker or local executor before production use.`,
    );
  }

  const safetyClass = inferSafetyClassFromSkill(skill);

  const tool: ToolContract = {
    name: skill.name || skill.id,
    description: skill.description ?? `OpenClaw skill: ${skill.id}`,
    input: skill.inputSchema ?? defaultSkillPromptSchema(),
    safetyClass,
    execute: resolveSkillExecutor(skill, options),
    timeoutMs: skill.timeoutSeconds ? skill.timeoutSeconds * 1000 : 30_000,
    idempotent: !skill.mutates,
    permissions: skill.requiresApproval ? ['approval_required'] : undefined,
    ...(skill.outputSchema ? { output: skill.outputSchema } : {}),
  };

  if (skill.metadata || skill.tags?.length) {
    warnings.push(
      `Skill "${skill.id}" metadata was preserved in tool metadata for interoperability`,
    );
    (tool as ToolContract & { metadata?: Record<string, unknown> }).metadata = {
      ...skill.metadata,
      openClawTags: skill.tags,
      openClawId: skill.id,
    };
  }

  return { tool, warnings };
}

/**
 * Convert a docs-native OpenClaw `SKILL.md` file into a Veridex ToolContract.
 */
export function importSkillDocument(
  document: OpenClawSkillDocument,
  options?: SkillImportOptions,
): SkillImportResult {
  const warnings: string[] = [];
  if (!document.instructions) {
    warnings.push(`Skill document "${document.filename}" has no markdown instructions`);
  }
  if (!document.frontmatter.description) {
    warnings.push(`Skill document "${document.filename}" is missing a description in frontmatter`);
  }

  const result = importSkill(documentToSkill(document), options);
  return {
    tool: result.tool,
    warnings: [...warnings, ...result.warnings],
  };
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
export function importSkillManifest(
  manifest: SkillManifest,
  options?: SkillImportOptions,
): ManifestImportResult {
  const tools: ToolContract[] = [];
  const warnings: string[] = [];

  if (manifest.version) {
    warnings.push(`OpenClaw manifest version: ${manifest.version}`);
  }

  for (const skill of manifest.skills) {
    const result = importSkill(skill, options);
    tools.push(result.tool);
    warnings.push(...result.warnings);
  }

  return {
    tools,
    warnings,
    sourceAgentId: manifest.agentId,
  };
}
