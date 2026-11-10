import { BillingCardStatus, FinanceExceptionCode, ScheduledVisitStatus } from '@prisma/client';
import { assessFundingBillingReadiness } from './funding-contract.util';
import { detectVisitExceptions } from './visit-reconciliation.util';

const base = {
  status: 'ACTIVE' as never,
  isActive: true,
  funderId: 'f1',
  defaultChargeCardId: 'c1',
  purchaseOrderNumber: null,
  purchaseOrderExpiresAt: null,
};

describe('funding billing readiness', () => {
  it("accepts the funder's billing contact when the line has none of its own", () => {
    expect(assessFundingBillingReadiness({ ...base, billingContactName: null, funderBillingContact: 'Finance team' }).issues).toEqual([]);
  });
  it('asks for a billing contact when neither the line nor the funder has one', () => {
    expect(assessFundingBillingReadiness({ ...base, billingContactName: null, funderBillingContact: null }).issues).toEqual([
      'Billing contact missing — add one to the funder in Settings → Funders',
    ]);
  });
});

describe('visit with no funding line', () => {
  it('is flagged before invoicing instead of being billed to the person', () => {
    const start = new Date('2026-11-02T09:00:00Z');
    const end = new Date('2026-11-02T10:00:00Z');
    const card = { id: 'c', status: BillingCardStatus.ACTIVE, rulesCount: 1 };
    const out = detectVisitExceptions({
      visit: {
        status: ScheduledVisitStatus.COMPLETED,
        plannedStartDateTime: start,
        plannedEndDateTime: end,
        actualStartDateTime: start,
        actualEndDateTime: end,
      },
      payCard: card,
      chargeCard: card,
      tasksIncomplete: false,
      funding: null,
    });
    expect(out).toContainEqual({
      code: FinanceExceptionCode.FUNDING_SETUP_INCOMPLETE,
      message: 'No funding set up — add who pays on the Funding tab',
    });
  });
});
