import { Logger } from '@nestjs/common';
import { SurveyDistributionJob } from './survey-distribution.job';

describe('SurveyDistributionJob', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('sends due surveys, closes surveys and periods past their end date, writes waiting answers, then captures CQC evidence', async () => {
    const order: string[] = [];
    const surveys = {
      runDueDistributions: jest.fn(async () => {
        order.push('send');
        return [
          { surveyId: 'a', ok: true, detail: 'sent 3' },
          { surveyId: 'b', ok: false, detail: 'The survey has no questions.' },
        ];
      }),
      closeSurveysPastEndDate: jest.fn(async () => {
        order.push('close');
        return 2;
      }),
      flushPendingResponses: jest.fn(async () => {
        order.push('flush');
        return { surveys: 1, written: 5 };
      }),
    };
    const cqc = {
      captureRecentlyClosed: jest.fn(async () => {
        order.push('cqc');
        return { checked: 1, captured: 1 };
      }),
    };
    const job = new SurveyDistributionJob(surveys as any, undefined, cqc as any);
    const outcome = await job.runDueDistributions();
    expect(surveys.runDueDistributions).toHaveBeenCalledWith(expect.any(Date));
    const now = (surveys.runDueDistributions.mock.calls[0] as unknown[])[0];
    expect(surveys.closeSurveysPastEndDate).toHaveBeenCalledWith(now);
    expect(surveys.flushPendingResponses).toHaveBeenCalledWith({ now });
    // Close, then write the closed surveys' waiting answers, then keep their results as evidence.
    expect(order).toEqual(['send', 'close', 'flush', 'cqc']);
    expect(outcome).toMatchObject({
      summary: { due: 2, distributed: 1, failed: 1, surveysClosed: 2, pendingResponsesWritten: 5, cqcEvidenceCaptured: 1 },
    });
  });

  it('a failed write of waiting answers does not stop the run', async () => {
    const surveys = {
      runDueDistributions: jest.fn(async () => []),
      closeSurveysPastEndDate: jest.fn(async () => 0),
      flushPendingResponses: jest.fn(async () => {
        throw new Error('database blip');
      }),
    };
    const outcome = await new SurveyDistributionJob(surveys as any).runDueDistributions();
    expect(outcome).toMatchObject({ summary: { pendingResponsesWritten: 0 } });
  });
});
