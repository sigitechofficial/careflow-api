import { Prisma } from '@prisma/client';
import { readPersonalSafetySnapshot } from './compose-context.loader';

/** Wraps lone-worker env factors as a submission-metadata object. */
function meta(env: Record<string, unknown>, extra: Record<string, unknown> = {}): Prisma.JsonValue {
  return { environmentAssessment: env, ...extra } as Prisma.JsonValue;
}

describe('Personal Safety care-plan wiring from the Lone Worker block', () => {
  it('derives loneWorkerRisk level from environment factors when no personalSafety block exists', () => {
    const snap = readPersonalSafetySnapshot(meta({ physicalViolence: true }));
    expect(snap?.loneWorkerRisk).toBe('High');
  });

  it('maps a Medium matrix outcome (unsafe area) to Medium', () => {
    const snap = readPersonalSafetySnapshot(meta({ unsafeArea: true }));
    expect(snap?.loneWorkerRisk).toBe('Medium');
  });

  it('flows Control Measures / Safety Actions into actionsInPlace', () => {
    const snap = readPersonalSafetySnapshot(
      meta({ unsafeArea: true, staffSafetyInstructions: 'Two carers required; call office on arrival.' }),
    );
    expect(snap?.actionsInPlace).toBe('Two carers required; call office on arrival.');
  });

  it('honours an explicit personalSafety block over the derived value', () => {
    const snap = readPersonalSafetySnapshot(
      meta({ physicalViolence: true }, { personalSafety: { loneWorkerRisk: 'Low' } }),
    );
    expect(snap?.loneWorkerRisk).toBe('Low');
  });

  it('returns null when there is no personal-safety evidence at all', () => {
    expect(readPersonalSafetySnapshot(meta({ unsafeArea: false }))).toBeNull();
    expect(readPersonalSafetySnapshot({} as Prisma.JsonValue)).toBeNull();
  });
});
