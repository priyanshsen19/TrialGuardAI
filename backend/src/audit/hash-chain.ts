/**
 * Tamper-evident SHA-256 hash chain (pure functions).
 *
 *   eventHash_n = SHA256( canonicalJSON({ eventId, chainId, sequence, timestamp,
 *                  eventType, actorType, actorId, component, componentVersion,
 *                  inputHash, outputHash, payload, previousEventHash: eventHash_{n-1} }) )
 *
 * Genesis events link to 64 zeros. Modifying any field of any event changes its
 * hash and breaks every later link, so verification detects the tampering.
 */
import { canonicalJson, sha256Hex } from '../common/canonical-json';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainEvent {
  eventId: string;
  chainId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  component: string;
  componentVersion: string;
  inputHash: string | null;
  outputHash: string | null;
  payload: unknown;
  previousEventHash: string;
  eventHash: string;
}

export type UnsealedEvent = Omit<ChainEvent, 'eventHash'>;

export function computeEventHash(e: UnsealedEvent): string {
  return sha256Hex(
    canonicalJson({
      eventId: e.eventId,
      chainId: e.chainId,
      sequence: e.sequence,
      timestamp: e.timestamp,
      eventType: e.eventType,
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      component: e.component,
      componentVersion: e.componentVersion,
      inputHash: e.inputHash ?? null,
      outputHash: e.outputHash ?? null,
      payload: e.payload ?? null,
      previousEventHash: e.previousEventHash,
    }),
  );
}

export function sealEvent(e: UnsealedEvent): ChainEvent {
  return { ...e, eventHash: computeEventHash(e) };
}

export interface VerificationResult {
  valid: boolean;
  eventsVerified: number;
  rootHash: string | null;
  firstInvalidSequence?: number;
  reason?: string;
}

export function verifyChain(events: ChainEvent[]): VerificationResult {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let previous = GENESIS_HASH;
  let verified = 0;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (e.sequence !== i + 1) {
      return { valid: false, eventsVerified: verified, rootHash: null, firstInvalidSequence: e.sequence, reason: `sequence gap: expected ${i + 1}, found ${e.sequence}` };
    }
    if (e.previousEventHash !== previous) {
      return { valid: false, eventsVerified: verified, rootHash: null, firstInvalidSequence: e.sequence, reason: `broken link at event ${e.sequence}: previousEventHash does not match hash of event ${e.sequence - 1}` };
    }
    const recomputed = computeEventHash(e);
    if (recomputed !== e.eventHash) {
      return { valid: false, eventsVerified: verified, rootHash: null, firstInvalidSequence: e.sequence, reason: `event ${e.sequence} content does not match its eventHash (record modified)` };
    }
    previous = e.eventHash;
    verified++;
  }
  return { valid: true, eventsVerified: verified, rootHash: ordered.length ? previous : null };
}
