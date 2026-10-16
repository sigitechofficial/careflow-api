import {
  correctionDifference,
  isPaySettled,
  payCorrectionDisplayStatus,
  withoutPaySnapshotFields,
} from './pay-settlement.util';

describe('payCorrectionDisplayStatus (R-01)', () => {
  const item = { status: 'APPROVED', includedInPayrollRunId: null, inOpenRun: false, reversed: false };
  it('names each stage of a correction', () => {
    expect(payCorrectionDisplayStatus({ ...item, status: 'PENDING_APPROVAL' })).toBe('PENDING_APPROVAL');
    expect(payCorrectionDisplayStatus(item)).toBe('APPROVED_FOR_PAYROLL');
    expect(payCorrectionDisplayStatus({ ...item, inOpenRun: true })).toBe('INCLUDED_IN_PAYROLL');
    expect(payCorrectionDisplayStatus({ ...item, includedInPayrollRunId: 'run' })).toBe('SETTLED');
    expect(payCorrectionDisplayStatus({ ...item, includedInPayrollRunId: 'run', reversed: true })).toBe('REVERSED');
    expect(payCorrectionDisplayStatus({ ...item, status: 'REJECTED', reversed: true })).toBe('REJECTED');
    expect(payCorrectionDisplayStatus({ ...item, status: 'CANCELLED' })).toBe('CANCELLED');
  });
});

describe('isPaySettled (VW-23)', () => {
  it('is settled by a locked visit pay run or by a closed UK run', () => {
    expect(isPaySettled({})).toBe(false);
    expect(isPaySettled({ includedInPayrollRunId: null, paidByUkPayrollRunId: null })).toBe(false);
    expect(isPaySettled({ includedInPayrollRunId: 'run' })).toBe(true);
    expect(isPaySettled({ paidByUkPayrollRunId: 'uk-run' })).toBe(true);
  });
});

describe('withoutPaySnapshotFields (SI-05)', () => {
  it('keeps charge-side and status fields, drops the pay snapshot', () => {
    const out = withoutPaySnapshotFields({
      status: 'APPROVED_FOR_BOTH',
      payableAmount: 21,
      payableMinutes: 90,
      approvedPayStart: new Date(),
      approvedPayEnd: new Date(),
      payCardId: 'card',
      payCardVersion: 2,
      travelMinutes: 10,
      billableAmount: 30,
      approvedBillStart: new Date(),
    });
    expect(Object.keys(out).sort()).toEqual(['approvedBillStart', 'billableAmount', 'status']);
  });
});

describe('correctionDifference (VW-22)', () => {
  it('positive backpay', () => {
    expect(correctionDifference(21, 14, [])).toBe(7);
  });
  it('negative correction', () => {
    expect(correctionDifference(10.5, 14, [])).toBe(-3.5);
  });
  it('takes earlier corrections into account, so the same correction twice is zero', () => {
    expect(correctionDifference(21, 14, [7])).toBe(0);
    expect(correctionDifference(25, 14, [7])).toBe(4);
    expect(correctionDifference(14, 14, [7, -7])).toBe(0);
  });
  it('is pence-exact', () => {
    expect(correctionDifference(0.3, 0.1, [0.1])).toBe(0.1);
  });
});
