import {
  earningCorrectionState,
  earningPhase,
  earningStage,
  earningStageLabel,
  furthestPayoutState,
  type EarningStageInput,
} from './earning-status.util';

const base: EarningStageInput = {
  status: 'PENDING_REVIEW',
  priced: false,
  inOpenPayRun: false,
  inLockedPayRun: false,
};
const stage = (over: Partial<EarningStageInput>) => earningStage({ ...base, ...over });

describe('earning stage projection (R-06)', () => {
  it('follows a visit from attendance to approval', () => {
    expect(stage({})).toBe('RECORDED');
    expect(stage({ priced: true })).toBe('RECONCILED');
    expect(stage({ status: 'REQUIRES_MANAGER_APPROVAL', priced: true })).toBe('RECONCILED');
    expect(stage({ status: 'APPROVED_FOR_PAY', priced: true })).toBe('APPROVED');
    expect(stage({ status: 'APPROVED_FOR_BOTH', priced: true })).toBe('APPROVED');
    expect(stage({ status: 'REJECTED_FOR_PAY', priced: true })).toBe('REJECTED');
  });

  it('distinguishes a draft visit pay run from a locked one', () => {
    expect(stage({ status: 'APPROVED_FOR_PAY', inOpenPayRun: true })).toBe('IN_DRAFT_PAY_RUN');
    expect(stage({ status: 'APPROVED_FOR_PAY', inOpenPayRun: true, inLockedPayRun: true })).toBe('IN_LOCKED_PAY_RUN');
  });

  it('a UK run that is not closed has not processed the pay', () => {
    for (const ukRunStatus of ['DRAFT', 'EMPLOYEES_ENROLLED', 'GROSS_CALCULATED', 'STATUTORY_CALCULATED']) {
      const s = stage({ status: 'APPROVED_FOR_PAY', inLockedPayRun: true, ukRunStatus });
      expect(s).toBe('IN_OPEN_UK_RUN');
      expect(earningPhase(s)).toBe('EARNED');
    }
  });

  it('a cancelled UK run holds nothing: the visit falls back to where it was', () => {
    expect(stage({ status: 'APPROVED_FOR_PAY', ukRunStatus: 'CANCELLED' })).toBe('APPROVED');
    expect(stage({ status: 'APPROVED_FOR_PAY', inLockedPayRun: true, ukRunStatus: 'CANCELLED' })).toBe('IN_LOCKED_PAY_RUN');
    // A payout cannot belong to a cancelled run; one that is reported anyway is not believed.
    expect(stage({ status: 'APPROVED_FOR_PAY', ukRunStatus: 'CANCELLED', payout: 'PAID' })).toBe('APPROVED');
  });

  it('a closed UK run is "payroll processed", never "paid", until a payout is recorded', () => {
    const closed = { status: 'APPROVED_FOR_PAY', inLockedPayRun: true, ukRunStatus: 'CLOSED' };
    expect(stage(closed)).toBe('IN_CLOSED_UK_RUN');
    expect(earningPhase(stage(closed))).toBe('PAYROLL_PROCESSED');
    expect(stage({ ...closed, payout: 'DRAFT' })).toBe('PAYMENT_PREPARED');
    expect(stage({ ...closed, payout: 'APPROVED' })).toBe('PAYMENT_APPROVED');
    expect(earningPhase('PAYMENT_APPROVED')).toBe('PAYMENT_PREPARED');
    expect(stage({ ...closed, payout: 'PAID' })).toBe('PAYMENT_RECORDED');
    expect(earningPhase('PAYMENT_RECORDED')).toBe('PAYMENT_RECORDED');
  });

  it('a payout against a run that was reopened does not show as recorded', () => {
    expect(stage({ status: 'APPROVED_FOR_PAY', ukRunStatus: 'STATUTORY_CALCULATED', payout: 'PAID' })).toBe('IN_OPEN_UK_RUN');
  });

  it('no label says the bank has confirmed anything', () => {
    const stages = [
      'RECORDED', 'RECONCILED', 'APPROVED', 'REJECTED', 'IN_DRAFT_PAY_RUN', 'IN_LOCKED_PAY_RUN',
      'IN_OPEN_UK_RUN', 'IN_CLOSED_UK_RUN', 'PAYMENT_PREPARED', 'PAYMENT_APPROVED', 'PAYMENT_RECORDED',
    ] as const;
    for (const s of stages) expect(earningStageLabel(s)).not.toMatch(/bank|confirmed|paid/i);
    expect(earningPhase('REJECTED')).toBe('NOT_PAYABLE');
  });
});

describe('furthest payout state', () => {
  it('ignores cancelled batches and skipped lines', () => {
    expect(furthestPayoutState([])).toBeNull();
    expect(furthestPayoutState([{ batchStatus: 'CANCELLED', lineStatus: 'PENDING' }])).toBeNull();
    expect(furthestPayoutState([{ batchStatus: 'PAID', lineStatus: 'SKIPPED' }])).toBeNull();
  });

  it('takes the furthest live payout', () => {
    expect(furthestPayoutState([{ batchStatus: 'DRAFT', lineStatus: 'PENDING' }])).toBe('DRAFT');
    expect(
      furthestPayoutState([
        { batchStatus: 'CANCELLED', lineStatus: 'PENDING' },
        { batchStatus: 'APPROVED', lineStatus: 'PENDING' },
        { batchStatus: 'DRAFT', lineStatus: 'PENDING' },
      ]),
    ).toBe('APPROVED');
    // A paid batch whose line for this carer was not marked paid has not paid this carer.
    expect(furthestPayoutState([{ batchStatus: 'PAID', lineStatus: 'PENDING' }])).toBe('APPROVED');
    expect(furthestPayoutState([{ batchStatus: 'PAID', lineStatus: 'PAID' }])).toBe('PAID');
  });
});

describe('correction state', () => {
  it('reports a pending correction before an approved one', () => {
    expect(earningCorrectionState([])).toBe('NONE');
    expect(earningCorrectionState([{ status: 'REJECTED' }, { status: 'CANCELLED' }])).toBe('NONE');
    expect(earningCorrectionState([{ status: 'APPROVED' }])).toBe('ADJUSTED');
    expect(earningCorrectionState([{ status: 'APPROVED' }, { status: 'PENDING_APPROVAL' }])).toBe('PENDING_APPROVAL');
  });
});
