import { movingHandlingNeedsTransferSupport, movingHandlingUsesHoist } from './initial-assessment-moving-handling.util';

describe('movingHandlingUsesHoist', () => {
  it('is undefined before the Moving & Handling worksheet has any task', () => {
    expect(movingHandlingUsesHoist(null)).toBeUndefined();
    expect(movingHandlingUsesHoist({})).toBeUndefined();
    expect(movingHandlingUsesHoist({ movingHandlingOperations: {} })).toBeUndefined();
    expect(movingHandlingUsesHoist({ movingHandlingOperations: { tasks: {} } })).toBeUndefined();
  });

  it('is true when any task lists a hoist', () => {
    expect(
      movingHandlingUsesHoist({
        movingHandlingOperations: {
          tasks: {
            walking: { methods: ['walkingAid'] },
            transfers: { methods: ['slidingSheets', 'hoist'] },
          },
        },
      }),
    ).toBe(true);
  });

  it('is false once tasks are recorded without a hoist (so a removed hoist clears the answer)', () => {
    expect(
      movingHandlingUsesHoist({
        movingHandlingOperations: {
          tasks: {
            walking: { methods: ['walkingAid'] },
            toileting: { capability: 'independent' },
          },
        },
      }),
    ).toBe(false);
  });
});

describe('movingHandlingNeedsTransferSupport', () => {
  const mh = (movingHandlingOperations: Record<string, unknown>) => ({ movingHandlingOperations });

  it('stays undefined until transfers are recorded', () => {
    expect(movingHandlingNeedsTransferSupport(null)).toBeUndefined();
    expect(movingHandlingNeedsTransferSupport(mh({ tasks: { walking: { capability: 'assistance' } } }))).toBeUndefined();
  });

  it('is true when any transfer needs supervision or assistance', () => {
    expect(movingHandlingNeedsTransferSupport(mh({ tasks: { toileting: { capability: 'supervision' } } }))).toBe(true);
  });

  it('is false only when every transfer is independent or the person is low risk', () => {
    const allIndependent = Object.fromEntries(
      ['gettingInOutOfBed', 'transfersBedToChair', 'moveUpBed', 'toileting'].map((id) => [id, { capability: 'independent' }]),
    );
    expect(movingHandlingNeedsTransferSupport(mh({ tasks: allIndependent }))).toBe(false);
    expect(movingHandlingNeedsTransferSupport(mh({ riskFilter: { totallyIndependentLowRisk: true } }))).toBe(false);
  });
});
