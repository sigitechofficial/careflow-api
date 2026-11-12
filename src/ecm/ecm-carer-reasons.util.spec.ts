import { EcmExceptionKind } from '@prisma/client';
import { buildEcmCarerReasons, ecmKindUsesCarerReasons } from './ecm-carer-reasons.util';

const carers = [
  { employeeId: 'lead', name: 'Priya Sharma' },
  { employeeId: 'support', name: 'Tom Hughes' },
];

describe('ecm-carer-reasons.util', () => {
  it('lists each carer arrival reason on a shared visit', () => {
    const reasons = buildEcmCarerReasons({
      kind: EcmExceptionKind.EARLY_ARRIVAL,
      carers,
      metadata: {
        employeeApp: {
          checkIns: {
            lead: { method: 'GPS', timingStatus: 'early', timingExceptionReasonCode: 'Scheduling change', timingExceptionNotes: 'Traffic was clear' },
            support: { method: 'GPS', timingStatus: 'early', timingExceptionNotes: 'Asked by office' },
          },
        },
      },
    });
    expect(reasons).toEqual([
      { employeeId: 'lead', name: 'Priya Sharma', kind: 'arrival', label: 'Scheduling change', notes: 'Traffic was clear' },
      { employeeId: 'support', name: 'Tom Hughes', kind: 'arrival', label: null, notes: 'Asked by office' },
    ]);
  });

  it('shows the visit clock-out reason once and drops a note equal to the reason', () => {
    const reasons = buildEcmCarerReasons({
      kind: EcmExceptionKind.SHORT_VISIT,
      carers,
      metadata: { timingExceptionReasonCode: 'Done early', timingExceptionNotes: 'Done early' },
    });
    expect(reasons).toEqual([
      { employeeId: null, name: null, kind: 'clock_out', label: 'Done early', notes: null },
    ]);
  });

  it('returns nothing for other kinds or when no reason was given', () => {
    expect(ecmKindUsesCarerReasons(EcmExceptionKind.CARER_SOS)).toBe(false);
    expect(
      buildEcmCarerReasons({ kind: EcmExceptionKind.CARER_SOS, carers, metadata: { timingExceptionNotes: 'x' } }),
    ).toEqual([]);
    expect(buildEcmCarerReasons({ kind: EcmExceptionKind.LATE_ARRIVAL, carers, metadata: {} })).toEqual([]);
    expect(buildEcmCarerReasons({ kind: EcmExceptionKind.EARLY_DEPARTURE, carers, metadata: null })).toEqual([]);
  });
});
