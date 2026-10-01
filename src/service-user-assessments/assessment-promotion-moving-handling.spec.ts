import { isMovingHandlingComplete } from './assessment-promotion-p3.util';

const riskFilter = {
  historyOfFalls: false,
  unsteadyMobilising: true,
  anxiousAboutFalls: false,
  confused: false,
  aged65PlusFallRiskMeds: false,
  sensoryOrMotorImpairment: false,
};
const allTasks = Object.fromEntries(
  ['walking', 'gettingInOutOfBed', 'transfersBedToChair', 'moveUpBed', 'toileting', 'bathOrShower'].map((id) => [
    id,
    { capability: 'assistance' },
  ]),
);

describe('isMovingHandlingComplete (matches the admin worksheet keys)', () => {
  it('is complete when the risk filter and every task are recorded', () => {
    expect(isMovingHandlingComplete({ movingHandlingOperations: { riskFilter, tasks: allTasks } })).toBe(true);
  });

  it('is complete for a totally independent, low-risk person without tasks', () => {
    expect(
      isMovingHandlingComplete({
        movingHandlingOperations: { riskFilter: { ...riskFilter, totallyIndependentLowRisk: true } },
      }),
    ).toBe(true);
  });

  it('is incomplete while a task or risk question is missing', () => {
    const { toileting: _omit, ...fewer } = allTasks;
    expect(isMovingHandlingComplete({ movingHandlingOperations: { riskFilter, tasks: fewer } })).toBe(false);
    expect(
      isMovingHandlingComplete({
        movingHandlingOperations: { riskFilter: { ...riskFilter, confused: null }, tasks: allTasks },
      }),
    ).toBe(false);
  });
});
