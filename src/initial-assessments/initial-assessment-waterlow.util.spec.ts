import {
  computeWaterlowScore,
  waterlowCarePlanRequired,
  waterlowScoreFromMetadata,
} from './initial-assessment-waterlow.util';

describe('initial-assessment-waterlow.util', () => {
  it('sums single-select and multi-select scores', () => {
    const score = computeWaterlowScore({
      gender: 2,
      age: 5,
      build: 0,
      appetite: 0,
      mobility: 5,
      continence: 0,
      neurological: 0,
      surgery: 0,
      medication: 0,
      weightLoss: 0,
      skinTypes: ['healthy'],
      tissueMalnutrition: [],
    });
    expect(score).toBe(12);
  });

  it('adds multiple skin and tissue selections', () => {
    const score = computeWaterlowScore({
      gender: 1,
      age: 3,
      build: 1,
      appetite: 1,
      mobility: 3,
      continence: 2,
      neurological: 5,
      surgery: 5,
      medication: 4,
      weightLoss: 1,
      skinTypes: ['dry', 'broken'],
      tissueMalnutrition: ['smoking', 'anaemia'],
    });
    expect(score).toBe(33);
  });

  it('reads legacy factors when new format absent', () => {
    expect(
      computeWaterlowScore({
        factors: { build: 2, skin: 1, sex: 2, age: 3, continence: 1, mobility: 2, appetite: 0, special: 0 },
      }),
    ).toBe(11);
  });

  it('waterlowScoreFromMetadata prefers stored score', () => {
    expect(
      waterlowScoreFromMetadata({
        waterlow: { score: 14, gender: 1, age: 1 },
      }),
    ).toBe(14);
  });

  it('care plan required at 10+', () => {
    expect(waterlowCarePlanRequired(9)).toBe(false);
    expect(waterlowCarePlanRequired(10)).toBe(true);
  });
});
