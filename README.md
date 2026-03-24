# @veridex/agents-openclaw

OpenClaw and Pi interoperability layer for the Veridex agent runtime.

## Status

`@veridex/agents-openclaw` is implemented and already supports context-file parsing, skill import, ACP collaboration, and session translation. It is still a young bridge, so the safest mental model is "incremental interoperability," not "perfect emulation of every OpenClaw behavior."

## What This Package Does

Use this package when you want to:

- import OpenClaw workspace context into Veridex
- parse docs-native `SKILL.md` files
- import serialized skill manifests
- expose or consume ACP-capable collaborators
- translate OpenClaw/Pi session artifacts into Veridex trace-friendly shapes

## Installation

```bash
npm install @veridex/agents-openclaw @veridex/agents
```

## Package Surface

| Export group | What it does |
|---|---|
| `parseWorkspaceContextFiles`, `parseContextFile`, `compileContextSections` | Parse and compile OpenClaw workspace context files |
| `parseSkillDocument`, `importSkill`, `importSkillDocument`, `importSkillManifest` | Convert skills and manifests into Veridex tool contracts |
| `toACPAgentCard`, `fromACPCapabilities`, `createRemoteAgentTool` | Bridge ACP-facing collaborators |
| `translateEvent`, `translateSession`, `translateSessions` | Map session artifacts into Veridex-friendly trace/event shapes |

## Context Files

The bridge understands OpenClaw workspace files such as:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `HEARTBEAT.md`
- `IDENTITY.md`
- `MEMORY.md`
- `SOUL.md`
- memory logs under `memory/YYYY-MM-DD.md`

Example:

```ts
import {
  parseWorkspaceContextFiles,
  compileContextSections,
} from '@veridex/agents-openclaw';

const files = parseWorkspaceContextFiles([
  {
    filename: 'BOOTSTRAP.md',
    content: '# Startup\nAlways explain the current plan before acting.',
  },
  {
    filename: 'MEMORY.md',
    content: '# Customers\nAcme is on the enterprise plan.',
  },
]);

const compiled = compileContextSections(files);
console.log(compiled);
```

## Importing `SKILL.md`

```ts
import {
  parseSkillDocument,
  importSkillDocument,
} from '@veridex/agents-openclaw';

const document = parseSkillDocument(`
---
name: fetch_account
description: Fetch an account record
tools:
  - id: fetch_account
    name: fetch_account
    description: Fetch an account record by id
    requiresNetwork: true
---

Look up the user account and summarize the important fields.
`);

const { tool, warnings } = importSkillDocument(document);

console.log(tool.name, warnings);
```

### Important behavior

Imported skills default to a fail-closed executor unless you:

- provide a concrete local executor, or
- bind the skill to a remote ACP/OpenClaw collaborator

That is deliberate. OpenClaw skills are often instruction bundles, not standalone executable tools.

## Binding Imported Skills to a Remote Collaborator

```ts
import { importSkillDocument, parseSkillDocument } from '@veridex/agents-openclaw';

const document = parseSkillDocument(rawSkillMarkdown, 'SKILL.md');

const { tool } = importSkillDocument(document, {
  remote: {
    name: 'remote-openclaw-agent',
    description: 'OpenClaw collaborator over ACP',
    endpoint: 'https://agent.example.com/acp',
    auth: {
      type: 'bearer',
      token: process.env.REMOTE_AGENT_TOKEN,
    },
  },
});
```

## ACP Bridge

Use ACP helpers when you want to collaborate with an OpenClaw-like or ACP-facing agent directly.

```ts
import { createRemoteAgentTool } from '@veridex/agents-openclaw';

const remoteTool = createRemoteAgentTool({
  name: 'portfolio-analyst',
  description: 'Remote analyst agent',
  endpoint: 'https://agent.example.com/acp',
  auth: {
    type: 'bearer',
    token: process.env.ACP_TOKEN,
  },
});
```

## Session Translation

If you already have OpenClaw or Pi session artifacts, translate them into Veridex-friendly event shapes:

```ts
import { translateSession } from '@veridex/agents-openclaw';

const translated = translateSession({
  sessionId: 'sess_123',
  agentId: 'claw-agent',
  events: [
    { type: 'run_started', timestamp: Date.now(), data: { input: 'hello' } },
  ],
});

console.log(translated.traceEvents);
```

## Migration Guidance

The safest way to move an OpenClaw workspace into Veridex is:

1. import the workspace context
2. import `SKILL.md` files and review warnings
3. bind real executors or remote ACP collaborators
4. register the resulting tools in a Veridex runtime
5. move high-control or payment-sensitive flows into Veridex-native policies and approvals

## Related Packages

| Package | Use it with |
|---|---|
| `@veridex/agents` | Required target runtime for imported skills and tools |
| `@veridex/agents-react` | Useful when you want to surface bridge behavior in a React UI |
| `@veridex/agents-adapters` | Use when the migration source is another framework family rather than OpenClaw/Pi |

## Known Rough Edges

- OpenClaw skills are not automatically executable just because they import cleanly.
- Some workspace conventions vary, so real-world skill packs may still need manual review.
- ACP collaboration is only as complete as the remote capability surface you bind to.

Contributions are welcome, especially around broader workspace fixtures, more migration examples, and more live ACP interoperability coverage.
