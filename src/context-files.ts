/**
 * @module ContextFileImporter
 * @description
 * Parse OpenClaw workspace context files (AGENTS.md, BOOTSTRAP.md,
 * IDENTITY.md, MEMORY.md, SOUL.md, USER.md, TOOLS.md, RULES.md,
 * KNOWLEDGE.md, daily memory logs) into
 * structured context sections for the Veridex runtime.
 *
 * Context files are markdown documents with headings that define
 * distinct context sections. The importer extracts these sections
 * and maps them so they can be injected into the runtime context
 * compiler.
 */

import type {
  ContextFile,
  ContextFileType,
  ContextSection,
} from './types';

// ── File Type Detection ──

const CONTEXT_FILE_PATTERNS: Record<string, ContextFileType> = {
  'AGENTS.md': 'AGENTS',
  'BOOTSTRAP.md': 'BOOTSTRAP',
  'HEARTBEAT.md': 'HEARTBEAT',
  'IDENTITY.md': 'IDENTITY',
  'MEMORY.md': 'MEMORY',
  'USER.md': 'USER',
  'SOUL.md': 'SOUL',
  'TOOLS.md': 'TOOLS',
  'RULES.md': 'RULES',
  'KNOWLEDGE.md': 'KNOWLEDGE',
};

/**
 * Detect the context file type from a filename.
 * Returns undefined if the filename doesn't match a known type.
 */
export function detectContextFileType(filename: string): ContextFileType | undefined {
  const normalized = filename.replace(/\\/g, '/');
  if (/\/?memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(normalized)) {
    return 'MEMORY';
  }

  const basename = normalized.split('/').pop() ?? normalized;
  return CONTEXT_FILE_PATTERNS[basename];
}

// ── Markdown Section Parser ──

/**
 * Parse a markdown document into heading-delimited sections.
 */
export function parseMarkdownSections(content: string): ContextSection[] {
  const lines = content.split('\n');
  const sections: ContextSection[] = [];
  let currentHeading = '';
  let currentDepth = 0;
  let currentLines: string[] = [];

  function flushSection() {
    if (currentHeading || currentLines.length > 0) {
      const body = currentLines.join('\n').trim();
      if (body.length > 0 || currentHeading) {
        sections.push({
          heading: currentHeading,
          depth: currentDepth,
          content: body,
        });
      }
    }
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushSection();
      currentDepth = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
    } else {
      currentLines.push(line);
    }
  }

  flushSection();
  return sections;
}

// ── Context File Importer ──

/**
 * Parse a single context file into a structured ContextFile.
 *
 * @param filename - The filename (e.g., "SOUL.md")
 * @param content - The raw markdown content
 * @returns The parsed context file, or null if the file type is not recognized
 */
export function parseContextFile(
  filename: string,
  content: string,
): ContextFile | null {
  const type = detectContextFileType(filename);
  if (!type) return null;

  return {
    type,
    raw: content,
    sections: parseMarkdownSections(content),
    filename,
  };
}

/**
 * Parse multiple context files from a workspace.
 *
 * @param files - Map of filename → content
 * @returns Parsed context files (unrecognized files are skipped)
 */
export function parseWorkspaceContextFiles(
  files: Record<string, string>,
): ContextFile[] {
  const results: ContextFile[] = [];
  for (const [filename, content] of Object.entries(files)) {
    const parsed = parseContextFile(filename, content);
    if (parsed) results.push(parsed);
  }
  return results;
}

/**
 * Compile parsed context files into a flat map of section identifiers → content.
 * Useful for injecting into the Veridex context compiler.
 *
 * Keys are formatted as `{type}/{heading}` (lowercase, spaces replaced with dashes).
 * Top-level content (no heading) uses `{type}/_root`.
 */
export function compileContextSections(
  files: ContextFile[],
): Record<string, string> {
  const compiled: Record<string, string> = {};

  for (const file of files) {
    const typeKey = buildFileNamespace(file);
    for (const section of file.sections) {
      const headingKey = section.heading
        ? section.heading.toLowerCase().replace(/\s+/g, '-')
        : '_root';
      const key = compiled[`${typeKey}/${headingKey}`]
        ? `${typeKey}/${headingKey}-${Object.keys(compiled).length + 1}`
        : `${typeKey}/${headingKey}`;
      compiled[key] = section.content;
    }
  }

  return compiled;
}

function buildFileNamespace(file: ContextFile): string {
  if (file.type !== 'MEMORY') {
    return file.type.toLowerCase();
  }

  const normalized = file.filename.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;
  if (/^\d{4}-\d{2}-\d{2}\.md$/i.test(basename)) {
    return `memory/${basename.replace(/\.md$/i, '').toLowerCase()}`;
  }

  return 'memory';
}
