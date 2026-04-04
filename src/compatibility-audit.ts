/**
 * @module CompatibilityAudit
 * @description
 * Coverage-style audit helpers for OpenClaw compatibility adapters.
 *
 * These audits are intentionally scoped to adapter packages so the core
 * Veridex runtime does not inherit a harness-parity product shape.
 */

import type {
  ACPCapability,
  OpenClawSession,
  OpenClawSkill,
} from './types';
import { translateSessions } from './session-translator';

type NamedCapability = string | Pick<OpenClawSkill, 'name'> | Pick<ACPCapability, 'name'>;

export interface CompatibilityAuditInput {
  /** Capabilities discovered in the imported OpenClaw/OpenClaw-adjacent surface. */
  importedCapabilities?: NamedCapability[];
  /** Capability wrappers currently implemented by the adapter package. */
  wrappedCapabilities?: NamedCapability[];
  /** Optional sessions to audit for event-shape and transcript compatibility. */
  sessions?: OpenClawSession[];
}

export interface EventShapeCompatibilityReport {
  /** Total event count inspected. */
  total: number;
  /** Events mapped with an exact event-shape match. */
  exact: number;
  /** Events mapped with best-effort inference. */
  inferred: number;
  /** Events that could not be mapped cleanly. */
  unmapped: number;
  /** Number of events that mapped without falling back to "unmapped". */
  mapped: number;
  /** Fraction of events that mapped cleanly. */
  coverage: number;
  /** Event types that remain unsupported. */
  unsupportedEventTypes: string[];
}

export interface TranscriptCompatibilityReport {
  /** Whether translated sessions can be replayed without unsupported event types. */
  compatible: boolean;
  /** Number of source events inspected. */
  sourceEventCount: number;
  /** Number of translated transcript events emitted. */
  translatedEventCount: number;
  /** Unsupported source event types. */
  unsupportedEventTypes: string[];
}

export interface CompatibilityAuditReport {
  /** Number of imported capabilities discovered from the source surface. */
  importedCapabilitiesFound: number;
  /** Number of imported capabilities with implemented wrappers. */
  wrappersImplemented: number;
  /** Fraction of imported capabilities that have wrappers. */
  wrapperCoverage: number;
  /** Imported capabilities still missing wrappers. */
  missingWrappers: string[];
  /** Aggregate unsupported surfaces across capabilities and sessions. */
  unsupportedSurfaces: string[];
  /** Event-shape compatibility summary. */
  eventShapeCompatibility: EventShapeCompatibilityReport;
  /** Transcript compatibility summary when session data is provided. */
  transcriptCompatibility?: TranscriptCompatibilityReport;
}

function normalizeCapabilityName(capability: NamedCapability): string {
  return typeof capability === 'string' ? capability : capability.name;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function buildCompatibilityAuditReport(
  input: CompatibilityAuditInput = {},
): CompatibilityAuditReport {
  const importedCapabilities = uniqueSorted(
    (input.importedCapabilities ?? []).map(normalizeCapabilityName),
  );
  const wrappedCapabilities = new Set(
    uniqueSorted((input.wrappedCapabilities ?? []).map(normalizeCapabilityName)),
  );

  const missingWrappers = importedCapabilities.filter(
    (capability) => !wrappedCapabilities.has(capability),
  );
  const wrappersImplemented = importedCapabilities.length - missingWrappers.length;
  const wrapperCoverage = importedCapabilities.length === 0
    ? 1
    : wrappersImplemented / importedCapabilities.length;

  const translatedSessions = input.sessions ? translateSessions(input.sessions) : [];
  let totalEvents = 0;
  let exactEvents = 0;
  let inferredEvents = 0;
  let unmappedEvents = 0;
  const unsupportedEventTypes = new Set<string>();

  for (const session of translatedSessions) {
    totalEvents += session.events.length;
    unmappedEvents += session.unmappedCount;

    for (const event of session.events) {
      if (event.confidence === 'exact') {
        exactEvents += 1;
      } else if (event.confidence === 'inferred') {
        inferredEvents += 1;
      }
    }

    for (const eventType of session.unmappedTypes) {
      unsupportedEventTypes.add(eventType);
    }
  }

  const mappedEvents = exactEvents + inferredEvents;
  const unsupportedSurfaces = uniqueSorted([
    ...missingWrappers.map((capability) => `capability:${capability}`),
    ...Array.from(unsupportedEventTypes).map((eventType) => `event:${eventType}`),
  ]);

  const eventShapeCompatibility: EventShapeCompatibilityReport = {
    total: totalEvents,
    exact: exactEvents,
    inferred: inferredEvents,
    unmapped: unmappedEvents,
    mapped: mappedEvents,
    coverage: totalEvents === 0 ? 1 : mappedEvents / totalEvents,
    unsupportedEventTypes: uniqueSorted(unsupportedEventTypes),
  };

  const transcriptCompatibility = input.sessions
    ? {
        compatible: unsupportedEventTypes.size === 0,
        sourceEventCount: input.sessions.reduce((count, session) => count + session.events.length, 0),
        translatedEventCount: totalEvents,
        unsupportedEventTypes: uniqueSorted(unsupportedEventTypes),
      } satisfies TranscriptCompatibilityReport
    : undefined;

  return {
    importedCapabilitiesFound: importedCapabilities.length,
    wrappersImplemented,
    wrapperCoverage,
    missingWrappers,
    unsupportedSurfaces,
    eventShapeCompatibility,
    transcriptCompatibility,
  };
}
