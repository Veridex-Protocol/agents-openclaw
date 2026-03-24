import { describe, it, expect } from 'vitest';

import {
  // Context files
  detectContextFileType,
  parseMarkdownSections,
  parseContextFile,
  parseWorkspaceContextFiles,
  compileContextSections,

  // Skill importer
  inferSafetyClassFromSkill,
  importSkill,
  importSkillManifest,

  // ACP bridge
  toACPAgentCard,
  fromACPCapabilities,
  createRemoteAgentTool,

  // Session translator
  translateEvent,
  translateSession,
  translateSessions,
} from '../src/index';

import type {
  OpenClawSkill,
  SkillManifest,
  OpenClawSession,
  OpenClawSessionEvent,
  RemoteAgentConfig,
  ACPCapability,
} from '../src/index';

// ─────────────────────────────────────────────
// Context File Importer
// ─────────────────────────────────────────────

describe('Context File Importer', () => {
  describe('detectContextFileType', () => {
    it('detects known context file types', () => {
      expect(detectContextFileType('AGENTS.md')).toBe('AGENTS');
      expect(detectContextFileType('SOUL.md')).toBe('SOUL');
      expect(detectContextFileType('IDENTITY.md')).toBe('IDENTITY');
      expect(detectContextFileType('USER.md')).toBe('USER');
      expect(detectContextFileType('TOOLS.md')).toBe('TOOLS');
      expect(detectContextFileType('RULES.md')).toBe('RULES');
      expect(detectContextFileType('KNOWLEDGE.md')).toBe('KNOWLEDGE');
    });

    it('returns undefined for unknown files', () => {
      expect(detectContextFileType('README.md')).toBeUndefined();
      expect(detectContextFileType('config.json')).toBeUndefined();
    });

    it('handles paths with directories', () => {
      expect(detectContextFileType('workspace/SOUL.md')).toBe('SOUL');
      expect(detectContextFileType('/project/agents/AGENTS.md')).toBe('AGENTS');
    });
  });

  describe('parseMarkdownSections', () => {
    it('parses a markdown document into sections', () => {
      const md = `# Title
Some intro text.

## Section One
Content of section one.

## Section Two
Content of section two.
More content here.`;

      const sections = parseMarkdownSections(md);
      expect(sections).toHaveLength(3);
      expect(sections[0].heading).toBe('Title');
      expect(sections[0].depth).toBe(1);
      expect(sections[0].content).toContain('Some intro text');
      expect(sections[1].heading).toBe('Section One');
      expect(sections[1].depth).toBe(2);
      expect(sections[2].heading).toBe('Section Two');
      expect(sections[2].content).toContain('More content here');
    });

    it('handles document with no headings', () => {
      const sections = parseMarkdownSections('Just plain text\nwith lines.');
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe('');
      expect(sections[0].content).toContain('Just plain text');
    });

    it('handles empty document', () => {
      const sections = parseMarkdownSections('');
      expect(sections).toHaveLength(0);
    });
  });

  describe('parseContextFile', () => {
    it('parses a recognized context file', () => {
      const result = parseContextFile(
        'SOUL.md',
        '# Soul\nYou are a helpful agent.\n\n## Personality\nFriendly and thorough.',
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('SOUL');
      expect(result!.sections).toHaveLength(2);
      expect(result!.filename).toBe('SOUL.md');
    });

    it('returns null for unrecognized files', () => {
      expect(parseContextFile('README.md', '# Readme')).toBeNull();
    });
  });

  describe('parseWorkspaceContextFiles', () => {
    it('parses multiple known files and skips unknowns', () => {
      const result = parseWorkspaceContextFiles({
        'SOUL.md': '# Soul\nBe kind.',
        'AGENTS.md': '# Agents\nAgent list.',
        'README.md': '# Readme',
        'config.json': '{}',
      });

      expect(result).toHaveLength(2);
      expect(result.map(f => f.type)).toContain('SOUL');
      expect(result.map(f => f.type)).toContain('AGENTS');
    });
  });

  describe('compileContextSections', () => {
    it('creates a flat key→content map', () => {
      const files = parseWorkspaceContextFiles({
        'SOUL.md': '# Core Values\nBe honest.\n\n## Tone\nFriendly.',
      });
      const compiled = compileContextSections(files);

      expect(compiled['soul/core-values']).toBe('Be honest.');
      expect(compiled['soul/tone']).toBe('Friendly.');
    });

    it('uses _root for content without heading', () => {
      const files = parseWorkspaceContextFiles({
        'USER.md': 'Top-level content here.',
      });
      const compiled = compileContextSections(files);
      expect(compiled['user/_root']).toBe('Top-level content here.');
    });
  });
});

// ─────────────────────────────────────────────
// Skill Importer
// ─────────────────────────────────────────────

describe('Skill Importer', () => {
  describe('inferSafetyClassFromSkill', () => {
    it('returns privileged for skills requiring approval', () => {
      const skill: OpenClawSkill = { id: 's1', name: 'admin', requiresApproval: true };
      expect(inferSafetyClassFromSkill(skill)).toBe('privileged');
    });

    it('returns financial for financially-tagged skills', () => {
      const skill: OpenClawSkill = { id: 's2', name: 'pay', tags: ['payment'] };
      expect(inferSafetyClassFromSkill(skill)).toBe('financial');
    });

    it('returns destructive for destructive-tagged skills', () => {
      const skill: OpenClawSkill = { id: 's3', name: 'cleanup', tags: ['delete-records'] };
      expect(inferSafetyClassFromSkill(skill)).toBe('destructive');
    });

    it('returns network for mutating + network skills', () => {
      const skill: OpenClawSkill = { id: 's4', name: 'api', mutates: true, requiresNetwork: true };
      expect(inferSafetyClassFromSkill(skill)).toBe('network');
    });

    it('returns write for mutating skills', () => {
      const skill: OpenClawSkill = { id: 's5', name: 'update', mutates: true };
      expect(inferSafetyClassFromSkill(skill)).toBe('write');
    });

    it('returns network for network-only skills', () => {
      const skill: OpenClawSkill = { id: 's6', name: 'fetch', requiresNetwork: true };
      expect(inferSafetyClassFromSkill(skill)).toBe('network');
    });

    it('defaults to read', () => {
      const skill: OpenClawSkill = { id: 's7', name: 'lookup' };
      expect(inferSafetyClassFromSkill(skill)).toBe('read');
    });
  });

  describe('importSkill', () => {
    it('converts a skill to a ToolContract', () => {
      const skill: OpenClawSkill = {
        id: 'file-reader',
        name: 'readFile',
        description: 'Read a file from disk',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        timeoutSeconds: 10,
      };

      const { tool, warnings } = importSkill(skill);
      expect(tool.name).toBe('readFile');
      expect(tool.description).toBe('Read a file from disk');
      expect(tool.safetyClass).toBe('read');
      expect(tool.timeoutMs).toBe(10_000);
      expect(tool.idempotent).toBe(true);
      expect(warnings).toHaveLength(0);
    });

    it('warns when no description is provided', () => {
      const skill: OpenClawSkill = { id: 'test', name: 'test' };
      const { warnings } = importSkill(skill);
      expect(warnings.some(w => w.includes('no description'))).toBe(true);
    });

    it('creates a stub executor', async () => {
      const skill: OpenClawSkill = { id: 'stub-test', name: 'stubTest', description: 'Test' };
      const { tool } = importSkill(skill);
      const result = await tool.execute({
        input: {},
        context: { runId: 'r1', agentId: 'a1', turnIndex: 0 },
      });
      expect(result.llmOutput).toContain('stub');
      expect(result.success).toBe(true);
    });
  });

  describe('importSkillManifest', () => {
    it('imports a full manifest', () => {
      const manifest: SkillManifest = {
        version: '1.0',
        agentId: 'agent-1',
        skills: [
          { id: 's1', name: 'read', description: 'Read' },
          { id: 's2', name: 'write', description: 'Write', mutates: true },
        ],
      };

      const result = importSkillManifest(manifest);
      expect(result.tools).toHaveLength(2);
      expect(result.sourceAgentId).toBe('agent-1');
      expect(result.warnings.some(w => w.includes('version'))).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────
// ACP Bridge
// ─────────────────────────────────────────────

describe('ACP Bridge', () => {
  const sampleDefinition = {
    id: 'agent-1',
    name: 'Test Agent',
    model: { provider: 'openai' as const, model: 'gpt-4o' },
    instructions: 'You are a test agent.',
    tools: [
      {
        name: 'search',
        description: 'Search the web',
        input: { type: 'object', properties: { query: { type: 'string' } } },
        safetyClass: 'network' as const,
        execute: async () => ({ llmOutput: 'found', success: true }),
      },
    ],
  };

  describe('toACPAgentCard', () => {
    it('generates an ACP agent card from a definition', () => {
      const card = toACPAgentCard(sampleDefinition, {
        endpoint: 'https://api.example.com/agent',
        version: '1.0.0',
      });

      expect(card.name).toBe('Test Agent');
      expect(card.description).toContain('test agent');
      expect(card.version).toBe('1.0.0');
      expect(card.capabilities).toHaveLength(1);
      expect(card.capabilities[0].name).toBe('search');
      expect(card.endpoint).toBe('https://api.example.com/agent');
    });

    it('uses default version when not specified', () => {
      const card = toACPAgentCard(sampleDefinition);
      expect(card.version).toBe('0.1.0');
    });

    it('handles agents with no tools', () => {
      const def = { ...sampleDefinition, tools: undefined };
      const card = toACPAgentCard(def);
      expect(card.capabilities).toHaveLength(0);
    });
  });

  describe('fromACPCapabilities', () => {
    const remote: RemoteAgentConfig = {
      name: 'Remote Agent',
      description: 'A remote collaborator',
      endpoint: 'https://example.com/agent',
      timeoutMs: 5000,
    };

    const capabilities: ACPCapability[] = [
      {
        name: 'analyze',
        description: 'Analyze data',
        inputSchema: { type: 'object', properties: { data: { type: 'string' } } },
        tags: ['read'],
      },
      {
        name: 'deploy',
        description: 'Deploy app',
        tags: ['write'],
      },
    ];

    it('converts capabilities to ToolContracts', () => {
      const tools = fromACPCapabilities(capabilities, remote);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('analyze');
      expect(tools[0].safetyClass).toBe('read');
      expect(tools[1].name).toBe('deploy');
      expect(tools[1].safetyClass).toBe('write');
    });

    it('defaults to network safety class when no tags', () => {
      const tools = fromACPCapabilities(
        [{ name: 'test', description: 'test' }],
        remote,
      );
      expect(tools[0].safetyClass).toBe('network');
    });
  });

  describe('createRemoteAgentTool', () => {
    it('creates a tool for invoking a remote agent', () => {
      const remote: RemoteAgentConfig = {
        name: 'Helper Agent',
        description: 'Helps with tasks',
        endpoint: 'https://helper.example.com',
      };

      const tool = createRemoteAgentTool(remote);
      expect(tool.name).toBe('remote_helper_agent');
      expect(tool.safetyClass).toBe('network');
      expect(tool.description).toContain('Helper Agent');
    });
  });
});

// ─────────────────────────────────────────────
// Session/Event Translator
// ─────────────────────────────────────────────

describe('Session Translator', () => {
  describe('translateEvent', () => {
    it('maps known event types', () => {
      const event: OpenClawSessionEvent = {
        type: 'user_message',
        timestamp: 1700000000000,
        data: { content: 'Hello' },
      };

      const result = translateEvent(event, 'run-1', 'agent-1');
      expect(result).not.toBeNull();
      expect(result!.event.type).toBe('message_received');
      expect(result!.confidence).toBe('exact');
    });

    it('maps tool events', () => {
      const event: OpenClawSessionEvent = {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:00Z',
        data: { tool: 'search' },
      };

      const result = translateEvent(event, 'run-1', 'agent-1');
      expect(result!.event.type).toBe('tool_proposed');
    });

    it('maps session lifecycle events', () => {
      const start: OpenClawSessionEvent = { type: 'session_start', timestamp: 1700000000 };
      const end: OpenClawSessionEvent = { type: 'session_end', timestamp: 1700001000 };

      expect(translateEvent(start, 'run-1', 'a1')!.event.type).toBe('run_started');
      expect(translateEvent(end, 'run-1', 'a1')!.event.type).toBe('run_completed');
    });

    it('handles unmapped events as error_occurred with unmapped confidence', () => {
      const event: OpenClawSessionEvent = {
        type: 'custom_obscure_event',
        timestamp: 1700000000000,
      };

      const result = translateEvent(event, 'run-1', 'agent-1');
      expect(result).not.toBeNull();
      expect(result!.event.type).toBe('error_occurred');
      expect(result!.confidence).toBe('unmapped');
      expect(result!.event.metadata?.originalType).toBe('custom_obscure_event');
    });

    it('normalizes ISO 8601 timestamps', () => {
      const event: OpenClawSessionEvent = {
        type: 'message',
        timestamp: '2024-06-15T12:00:00Z',
      };

      const result = translateEvent(event, 'run-1', 'agent-1');
      expect(result!.event.timestamp).toBe(Date.parse('2024-06-15T12:00:00Z'));
    });

    it('normalizes epoch second timestamps', () => {
      const event: OpenClawSessionEvent = {
        type: 'message',
        timestamp: 1700000000, // seconds
      };

      const result = translateEvent(event, 'run-1', 'agent-1');
      expect(result!.event.timestamp).toBe(1700000000000); // converted to ms
    });
  });

  describe('translateSession', () => {
    it('translates a full session', () => {
      const session: OpenClawSession = {
        sessionId: 'session-1',
        agentId: 'agent-1',
        events: [
          { type: 'session_start', timestamp: 1700000000000 },
          { type: 'user_message', timestamp: 1700000001000, data: { content: 'hi' } },
          { type: 'llm_response', timestamp: 1700000002000 },
          { type: 'session_end', timestamp: 1700000003000 },
        ],
      };

      const result = translateSession(session);
      expect(result.events).toHaveLength(4);
      expect(result.unmappedCount).toBe(0);
      expect(result.sourceSessionId).toBe('session-1');
      expect(result.runId).toBe('run_oc_session-1');
    });

    it('tracks unmapped events', () => {
      const session: OpenClawSession = {
        sessionId: 'session-2',
        events: [
          { type: 'session_start', timestamp: 1700000000000 },
          { type: 'weird_event', timestamp: 1700000001000 },
          { type: 'another_custom', timestamp: 1700000002000 },
        ],
      };

      const result = translateSession(session);
      expect(result.unmappedCount).toBe(2);
      expect(result.unmappedTypes).toContain('weird_event');
      expect(result.unmappedTypes).toContain('another_custom');
    });
  });

  describe('translateSessions', () => {
    it('translates multiple sessions', () => {
      const sessions: OpenClawSession[] = [
        {
          sessionId: 's1',
          events: [{ type: 'session_start', timestamp: 1700000000000 }],
        },
        {
          sessionId: 's2',
          events: [{ type: 'session_start', timestamp: 1700001000000 }],
        },
      ];

      const results = translateSessions(sessions);
      expect(results).toHaveLength(2);
      expect(results[0].sourceSessionId).toBe('s1');
      expect(results[1].sourceSessionId).toBe('s2');
    });
  });
});
