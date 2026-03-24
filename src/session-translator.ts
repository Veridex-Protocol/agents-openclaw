/**
 * @module SessionTranslator
 * @description
 * Translate OpenClaw/Pi session events into Veridex TraceEvents.
 *
 * OpenClaw sessions contain unstructured events with free-form types.
 * This translator maps known event types into the Veridex canonical
 * trace format with best-effort field mapping.
 */

import type { TraceEventType } from '@veridex/agents';
import type { OpenClawSession, OpenClawSessionEvent } from './types';

// ── Event Type Mapping ──

/**
 * Map of OpenClaw event types to Veridex TraceEventTypes.
 * Unmapped types are skipped during translation.
 */
const EVENT_TYPE_MAP: Record<string, TraceEventType> = {
  // Message events
  'message': 'message_received',
  'user_message': 'message_received',
  'agent_message': 'message_received',
  'system_message': 'message_received',

  // Model events
  'llm_call': 'model_call_started',
  'llm_start': 'model_call_started',
  'model_start': 'model_call_started',
  'llm_response': 'model_call_completed',
  'llm_end': 'model_call_completed',
  'model_end': 'model_call_completed',
  'model_response': 'model_call_completed',

  // Tool events
  'tool_call': 'tool_proposed',
  'tool_start': 'tool_proposed',
  'skill_call': 'tool_proposed',
  'tool_result': 'tool_executed',
  'tool_end': 'tool_executed',
  'skill_result': 'tool_executed',

  // Memory events
  'memory_write': 'memory_written',
  'memory_store': 'memory_written',

  // Approval events
  'approval_request': 'approval_requested',
  'approval_needed': 'approval_requested',

  // Session lifecycle
  'session_start': 'run_started',
  'run_start': 'run_started',
  'session_end': 'run_completed',
  'run_end': 'run_completed',

  // Error events
  'error': 'error_occurred',
  'failure': 'error_occurred',
  'run_error': 'run_failed',
  'session_error': 'run_failed',

  // Hook events
  'hook': 'hook_executed',
  'plugin': 'hook_executed',

  // Payment events
  'payment': 'payment_attempted',
  'transaction': 'payment_attempted',

  // Context events
  'context': 'context_compiled',
  'context_build': 'context_compiled',
};

// ── Timestamp Normalization ──

/**
 * Normalize a timestamp to epoch milliseconds.
 */
function normalizeTimestamp(ts: string | number): number {
  if (typeof ts === 'number') {
    // If it looks like seconds (before year 2100 in seconds), convert to ms
    return ts < 4_102_444_800 ? ts * 1000 : ts;
  }
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

// ── Event Translation ──

/** Minimal trace event shape for translated events. */
export interface TranslatedTraceEvent {
  id: string;
  type: TraceEventType;
  runId: string;
  agentId: string;
  turnIndex?: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Result of translating a single event. */
export interface TranslatedEvent {
  /** The Veridex trace event */
  event: TranslatedTraceEvent;
  /** Whether the translation was an exact match or best-effort */
  confidence: 'exact' | 'inferred' | 'unmapped';
}

/** Result of translating a full session. */
export interface SessionTranslationResult {
  /** Translated events */
  events: TranslatedEvent[];
  /** Number of events that could not be mapped */
  unmappedCount: number;
  /** Original event types that had no mapping */
  unmappedTypes: string[];
  /** Source session ID */
  sourceSessionId: string;
  /** Generated Veridex run ID */
  runId: string;
}

let eventCounter = 0;
function generateEventId(): string {
  return `evt_oc_${Date.now()}_${++eventCounter}`;
}

/**
 * Translate a single OpenClaw session event into a Veridex TraceEvent.
 * Returns null if the event type cannot be mapped and strict mode is off.
 */
export function translateEvent(
  event: OpenClawSessionEvent,
  runId: string,
  agentId: string,
): TranslatedEvent | null {
  const mappedType = EVENT_TYPE_MAP[event.type.toLowerCase()];

  if (!mappedType) {
    return {
      event: {
        id: generateEventId(),
        type: 'error_occurred',
        runId,
        agentId,
        timestamp: normalizeTimestamp(event.timestamp),
        metadata: {
          originalType: event.type,
          originalData: event.data,
          translationNote: 'unmapped_event_type',
        },
      },
      confidence: 'unmapped',
    };
  }

  const baseEvent: TranslatedTraceEvent = {
    id: generateEventId(),
    type: mappedType,
    runId,
    agentId,
    timestamp: normalizeTimestamp(event.timestamp),
    metadata: {
      ...event.metadata,
      originalType: event.type,
      source: 'openclaw',
    },
  };

  // Determine confidence based on how exact the mapping is
  const confidence = event.type.toLowerCase() in EVENT_TYPE_MAP
    ? 'exact' as const
    : 'inferred' as const;

  return { event: baseEvent, confidence };
}

/**
 * Translate an entire OpenClaw session into Veridex trace events.
 */
export function translateSession(
  session: OpenClawSession,
): SessionTranslationResult {
  const runId = `run_oc_${session.sessionId}`;
  const agentId = session.agentId ?? 'unknown';
  const events: TranslatedEvent[] = [];
  const unmappedTypes = new Set<string>();
  let unmappedCount = 0;

  for (const event of session.events) {
    const translated = translateEvent(event, runId, agentId);
    if (translated) {
      events.push(translated);
      if (translated.confidence === 'unmapped') {
        unmappedCount++;
        unmappedTypes.add(event.type);
      }
    }
  }

  return {
    events,
    unmappedCount,
    unmappedTypes: Array.from(unmappedTypes),
    sourceSessionId: session.sessionId,
    runId,
  };
}

/**
 * Translate multiple sessions and merge their events chronologically.
 */
export function translateSessions(
  sessions: OpenClawSession[],
): SessionTranslationResult[] {
  return sessions.map(translateSession);
}
