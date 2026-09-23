import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../backend/src/common/canonical-json';
import { GENESIS_HASH, sealEvent, verifyChain, type ChainEvent } from '../../backend/src/audit/hash-chain';

function buildChain(n: number): ChainEvent[] {
  const events: ChainEvent[] = [];
  for (let i = 1; i <= n; i++) {
    events.push(
      sealEvent({
        eventId: `evt-${i}`,
        chainId: 'screening-1',
        sequence: i,
        timestamp: `2026-09-23T10:00:${String(i).padStart(2, '0')}.000Z`,
        eventType: i === 1 ? 'SCREENING_CREATED' : 'CRITERION_EVALUATED',
        actorType: 'SYSTEM',
        actorId: null,
        component: 'rule-engine',
        componentVersion: '1.0.0',
        inputHash: 'a'.repeat(64),
        outputHash: 'b'.repeat(64),
        payload: { criterionId: `INC-00${i}`, result: 'PASS', actualValue: 72 },
        previousEventHash: i === 1 ? GENESIS_HASH : events[i - 2].eventHash,
      }),
    );
  }
  return events;
}

describe('audit hash chain', () => {
  it('10 events → valid; modify #5 → invalid; restore → valid', () => {
    const chain = buildChain(10);
    expect(verifyChain(chain)).toMatchObject({ valid: true, eventsVerified: 10, rootHash: chain[9].eventHash });

    const original = structuredClone(chain[4].payload);
    (chain[4].payload as { result: string }).result = 'FAIL';
    const tampered = verifyChain(chain);
    expect(tampered.valid).toBe(false);
    expect(tampered.firstInvalidSequence).toBe(5);

    chain[4].payload = original;
    expect(verifyChain(chain)).toMatchObject({ valid: true, eventsVerified: 10 });
  });
  it('detects re-hashed tampering (link to the next event breaks)', () => {
    const chain = buildChain(10);
    (chain[4].payload as { result: string }).result = 'FAIL';
    chain[4] = sealEvent({ ...chain[4] }); // attacker recomputes event 5's own hash
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.firstInvalidSequence).toBe(6);
  });
  it('detects deletion and reordering', () => {
    const chain = buildChain(10);
    expect(verifyChain(chain.filter((e) => e.sequence !== 3)).valid).toBe(false);
    const swapped = [...chain];
    [swapped[2].timestamp, swapped[3].timestamp] = [swapped[3].timestamp, swapped[2].timestamp];
    expect(verifyChain(swapped).valid).toBe(false);
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});
