import {
  mapWaterlowScoreToCarePlanBand,
  readWaterlowFromSubmissionMetadata,
} from './compose-waterlow-metadata.util';

describe('readWaterlowFromSubmissionMetadata', () => {
  it('returns null when metadata has no waterlow block', () => {
    expect(readWaterlowFromSubmissionMetadata(null)).toBeNull();
    expect(readWaterlowFromSubmissionMetadata({})).toBeNull();
    expect(readWaterlowFromSubmissionMetadata({ adl: { rows: [] } })).toBeNull();
  });

  it('reads the stored Waterlow score', () => {
    expect(readWaterlowFromSubmissionMetadata({ waterlow: { score: 17 } })).toEqual({ score: 17 });
  });

  it('falls back to summing enteredScores when score is absent', () => {
    expect(
      readWaterlowFromSubmissionMetadata({
        waterlow: { enteredScores: { gender: 2, age: 4, mobility: 5 } },
      }),
    ).toEqual({ score: 11 });
  });

  it('prefers the stored score over enteredScores', () => {
    expect(
      readWaterlowFromSubmissionMetadata({
        waterlow: { score: 8, enteredScores: { gender: 2 } },
      }),
    ).toEqual({ score: 8 });
  });
});

describe('mapWaterlowScoreToCarePlanBand', () => {
  it('maps completed scores onto the Pressure Ulcer SELECT options', () => {
    expect(mapWaterlowScoreToCarePlanBand(1)).toBe('Low');
    expect(mapWaterlowScoreToCarePlanBand(9)).toBe('Low');
    expect(mapWaterlowScoreToCarePlanBand(10)).toBe('At risk');
    expect(mapWaterlowScoreToCarePlanBand(14)).toBe('At risk');
    expect(mapWaterlowScoreToCarePlanBand(15)).toBe('High');
    expect(mapWaterlowScoreToCarePlanBand(19)).toBe('High');
    expect(mapWaterlowScoreToCarePlanBand(20)).toBe('Very high');
  });

  it('treats 0 / incomplete as no band', () => {
    expect(mapWaterlowScoreToCarePlanBand(0)).toBeNull();
    expect(mapWaterlowScoreToCarePlanBand(Number.NaN)).toBeNull();
  });
});
