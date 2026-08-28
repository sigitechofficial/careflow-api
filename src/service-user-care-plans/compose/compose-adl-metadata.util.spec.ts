import {
  readAdlMetadataFromSubmissionMetadata,
} from './compose-adl-metadata.util';

describe('readAdlMetadataFromSubmissionMetadata', () => {
  it('returns null when metadata is missing or has no adl block', () => {
    expect(readAdlMetadataFromSubmissionMetadata(null)).toBeNull();
    expect(readAdlMetadataFromSubmissionMetadata({})).toBeNull();
    expect(readAdlMetadataFromSubmissionMetadata({ adl: {} })).toBeNull();
  });

  it('parses ADL rows and mobility aid fields from submission metadata', () => {
    const result = readAdlMetadataFromSubmissionMetadata({
      adl: {
        rows: [
          { id: 'bathing', activity: 'Bathing', score: 2, notes: 'AM only' },
          { id: 'shopping', activity: 'Shopping', score: 0 },
        ],
        additionalComments: 'Uses frame indoors',
        mobilityAidsRequired: true,
        mobilityAidsList: 'Walking frame',
        fallsAssessmentCompleted: true,
        fallsAssessmentDate: '2026-08-01',
      },
    });

    expect(result).toEqual({
      rows: [
        { id: 'bathing', activity: 'Bathing', score: 2, notes: 'AM only' },
        { id: 'shopping', activity: 'Shopping', score: 0 },
      ],
      additionalComments: 'Uses frame indoors',
      mobilityAidsRequired: true,
      mobilityAidsList: 'Walking frame',
      fallsAssessmentCompleted: true,
      fallsAssessmentDate: '2026-08-01',
      fallsScreeningRequested: null,
    });
  });

  it('ignores invalid rows and defaults invalid scores to 0', () => {
    const result = readAdlMetadataFromSubmissionMetadata({
      adl: {
        rows: [{ id: '', activity: 'Bad' }, { id: 'eating_drinking', score: 99 }],
      },
    });
    expect(result?.rows).toEqual([{ id: 'eating_drinking', activity: 'eating_drinking', score: 0 }]);
  });
});
