/**
 * @packageDocumentation
 * @module @veridex/agents-openclaw
 * @description
 * OpenClaw/Pi compatibility bridge for the Veridex Agent Runtime.
 *
 * Provides:
 * - Context-file importer (AGENTS.md, SOUL.md, etc.)
 * - Skill manifest importer
 * - ACP bridge (expose & consume)
 * - Session/event translator
 * - Remote agent adapter
 */

// ── Types ──
export type {
  ContextFileType,
  ContextFile,
  ContextSection,
  OpenClawSkill,
  OpenClawSkillDocument,
  OpenClawSkillFrontmatter,
  SkillManifest,
  OpenClawSessionEvent,
  OpenClawSession,
  ACPCapability,
  ACPAgentCard,
  ACPInvocationRequest,
  ACPInvocationResponse,
  ACPInvoker,
  RemoteAgentConfig,
} from './types';

// ── Compatibility Audit ──
export { buildCompatibilityAuditReport } from './compatibility-audit';
export type {
  CompatibilityAuditInput,
  CompatibilityAuditReport,
  EventShapeCompatibilityReport,
  TranscriptCompatibilityReport,
} from './compatibility-audit';

// ── Context File Importer ──
export {
  detectContextFileType,
  parseMarkdownSections,
  parseContextFile,
  parseWorkspaceContextFiles,
  compileContextSections,
} from './context-files';

// ── Skill Importer ──
export {
  inferSafetyClassFromSkill,
  parseSkillDocument,
  importSkill,
  importSkillDocument,
  importSkillManifest,
} from './skill-importer';
export type {
  SkillImportOptions,
  SkillImportResult,
  ManifestImportResult,
} from './skill-importer';

// ── ACP Bridge ──
export {
  toACPAgentCard,
  fromACPCapabilities,
  createRemoteAgentTool,
} from './acp-bridge';

// ── Session/Event Translator ──
export {
  translateEvent,
  translateSession,
  translateSessions,
} from './session-translator';
export type {
  TranslatedEvent,
  TranslatedTraceEvent,
  SessionTranslationResult,
} from './session-translator';
