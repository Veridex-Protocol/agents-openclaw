/**
 * @module OpenClawTypes
 * @description
 * Type definitions representing OpenClaw/Pi workspace structures,
 * skill definitions, session artifacts, and context files.
 *
 * These types model the external OpenClaw format so that importers
 * can convert them into Veridex-native structures.
 */

// ── Context Files ──

/** Known OpenClaw context file types. */
export type ContextFileType =
  | 'AGENTS'
  | 'BOOTSTRAP'
  | 'HEARTBEAT'
  | 'IDENTITY'
  | 'MEMORY'
  | 'USER'
  | 'SOUL'
  | 'TOOLS'
  | 'RULES'
  | 'KNOWLEDGE';

/** A parsed OpenClaw context file (e.g., AGENTS.md, SOUL.md). */
export interface ContextFile {
  /** File type (derived from filename) */
  type: ContextFileType;
  /** Raw file content */
  raw: string;
  /** Parsed sections keyed by heading */
  sections: ContextSection[];
  /** Source filename */
  filename: string;
}

/** A section within a context file, extracted by markdown headings. */
export interface ContextSection {
  /** Section heading text */
  heading: string;
  /** Heading depth (1 = #, 2 = ##, etc.) */
  depth: number;
  /** Section body content (trimmed) */
  content: string;
}

// ── Skill Definitions ──

/** An OpenClaw skill definition (the external format). */
export interface OpenClawSkill {
  /** Skill unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Skill description */
  description?: string;
  /** Input parameters schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** Skill tags/categories */
  tags?: string[];
  /** Whether the skill modifies state */
  mutates?: boolean;
  /** Whether the skill requires network access */
  requiresNetwork?: boolean;
  /** Whether the skill requires approval before execution */
  requiresApproval?: boolean;
  /** Execution timeout in seconds */
  timeoutSeconds?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/** Document-native OpenClaw skill metadata extracted from SKILL.md frontmatter. */
export interface OpenClawSkillFrontmatter {
  /** Unique identifier (snake_case in OpenClaw docs). */
  name: string;
  /** One-line description shown to the agent. */
  description: string;
  /** Optional OpenClaw metadata block. */
  metadata?: {
    openclaw?: {
      os?: string[];
      requires?: {
        bins?: string[];
        config?: string[];
      };
    };
    [key: string]: unknown;
  };
  /** Optional tool definitions shipped with the skill. */
  tools?: OpenClawSkill[];
  /** Preserve unknown keys for forward compatibility. */
  [key: string]: unknown;
}

/** Parsed SKILL.md document in the OpenClaw docs-native format. */
export interface OpenClawSkillDocument {
  /** Source filename, usually SKILL.md */
  filename: string;
  /** Raw markdown content */
  raw: string;
  /** Parsed YAML frontmatter */
  frontmatter: OpenClawSkillFrontmatter;
  /** Markdown body after the frontmatter */
  instructions: string;
}

/** A skill manifest — collection of skills with workspace metadata. */
export interface SkillManifest {
  /** Manifest version */
  version?: string;
  /** Workspace or agent identifier */
  agentId?: string;
  /** Skills defined in this manifest */
  skills: OpenClawSkill[];
  /** Workspace-level metadata */
  metadata?: Record<string, unknown>;
}

// ── Session and Run Artifacts ──

/** An OpenClaw session event (the external format). */
export interface OpenClawSessionEvent {
  /** Event type identifier */
  type: string;
  /** Event timestamp (ISO 8601 or epoch ms) */
  timestamp: string | number;
  /** Session ID */
  sessionId?: string;
  /** Associated agent/skill name */
  agent?: string;
  /** Event payload */
  data?: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** An OpenClaw session artifact — a collection of events for one session/run. */
export interface OpenClawSession {
  /** Session unique identifier */
  sessionId: string;
  /** Agent identifier */
  agentId?: string;
  /** Session events in chronological order */
  events: OpenClawSessionEvent[];
  /** Session start time */
  startedAt?: string | number;
  /** Session end time */
  endedAt?: string | number;
  /** Session-level metadata */
  metadata?: Record<string, unknown>;
}

// ── ACP (Agent Communication Protocol) ──

/** ACP capability descriptor for a Veridex agent exposed via ACP. */
export interface ACPCapability {
  /** Capability name */
  name: string;
  /** Description of what this capability does */
  description: string;
  /** Input schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** Tags for discovery */
  tags?: string[];
}

/** ACP agent card — the public descriptor of an agent. */
export interface ACPAgentCard {
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Agent version */
  version?: string;
  /** Capabilities exposed via ACP */
  capabilities: ACPCapability[];
  /** Agent endpoint URL (for remote invocation) */
  endpoint?: string;
  /** Agent metadata */
  metadata?: Record<string, unknown>;
}

/** ACP invocation request. */
export interface ACPInvocationRequest {
  /** Target capability name */
  capability: string;
  /** Input data */
  input: Record<string, unknown>;
  /** Caller identifier */
  callerId?: string;
  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/** ACP invocation response. */
export interface ACPInvocationResponse {
  /** Whether the invocation succeeded */
  success: boolean;
  /** Output data */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Response metadata */
  metadata?: Record<string, unknown>;
}

/** Pluggable remote ACP invoker for non-HTTP transports such as stdio bridges. */
export interface ACPInvoker {
  invoke(
    request: ACPInvocationRequest,
    signal?: AbortSignal,
  ): Promise<ACPInvocationResponse>;
}

// ── Remote Agent ──

/** Configuration for treating an OpenClaw agent as a remote collaborator. */
export interface RemoteAgentConfig {
  /** Remote agent name */
  name: string;
  /** Remote agent description */
  description: string;
  /** Endpoint URL */
  endpoint: string;
  /** Authentication method */
  auth?: {
    type: 'bearer' | 'api-key' | 'none';
    token?: string;
    headerName?: string;
  };
  /** Available capabilities (if known) */
  capabilities?: ACPCapability[];
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Optional custom transport implementation for ACP invocation. */
  invoker?: ACPInvoker;
}
