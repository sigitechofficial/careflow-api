import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  classifyEvaluationFailure,
  payEvaluationSubjectKey,
  TECHNICAL_FAILURE_MESSAGE,
} from './pay-evaluation-failure.util';

describe('classifyEvaluationFailure (R-17)', () => {
  it('a missing employment record is a business failure the office can fix and retry', () => {
    const f = classifyEvaluationFailure(
      new NotFoundException('Employee employment record not found'),
    );
    expect(f).toMatchObject({
      kind: 'BUSINESS',
      category: 'EMPLOYMENT_RECORD_MISSING',
      message: 'Employee employment record not found',
      retryable: true,
    });
  });

  it('names other expected failures by what they are about', () => {
    expect(
      classifyEvaluationFailure(
        new BadRequestException('No published pay card applies on this date'),
      ).category,
    ).toBe('PAY_CARD_UNRESOLVED');
    expect(
      classifyEvaluationFailure(
        new BadRequestException('The start is at or after the finish'),
      ).category,
    ).toBe('INVALID_TIMES');
    expect(
      classifyEvaluationFailure(new NotFoundException('Visit not found'))
        .category,
    ).toBe('RECORD_MISSING');
    expect(
      classifyEvaluationFailure(new BadRequestException('Not allowed'))
        .category,
    ).toBe('BUSINESS_RULE');
  });

  it('a refusal by the locked-history trigger is not retryable and points to corrections', () => {
    const f = classifyEvaluationFailure(
      new Error('LOCKED_PAYROLL_HISTORY: visit reconciliation 123 is settled'),
    );
    expect(f).toMatchObject({
      kind: 'BUSINESS',
      category: 'LOCKED_HISTORY',
      retryable: false,
    });
    expect(f.message).toMatch(/pay correction/i);
  });

  it('a database error is technical; its text, which holds query values, is never passed on', () => {
    class PrismaClientKnownRequestError extends Error {
      code = 'P2034';
    }
    const f = classifyEvaluationFailure(
      new PrismaClientKnownRequestError(
        'Invalid `prisma.x.update()` invocation: WHERE email = jane@example.com',
      ),
    );
    expect(f).toMatchObject({
      kind: 'TECHNICAL',
      category: 'DATABASE',
      message: TECHNICAL_FAILURE_MESSAGE,
      retryable: true,
      detail: {
        errorName: 'PrismaClientKnownRequestError',
        errorCode: 'P2034',
      },
    });
    expect(JSON.stringify(f)).not.toContain('jane@example.com');
  });

  it('anything else is an unexpected technical failure, also without its text', () => {
    for (const err of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new InternalServerErrorException('boom'),
      'a string',
    ]) {
      const f = classifyEvaluationFailure(err);
      expect(f).toMatchObject({
        kind: 'TECHNICAL',
        category: 'UNEXPECTED',
        message: TECHNICAL_FAILURE_MESSAGE,
      });
    }
  });

  it('one subject key per reconciliation, visit or job', () => {
    expect(payEvaluationSubjectKey('EVALUATE', 'r1')).toBe('RECON:r1');
    expect(payEvaluationSubjectKey('ENSURE_VISIT', 'v1')).toBe('VISIT:v1');
    expect(payEvaluationSubjectKey('ENSURE_JOB', 'j1')).toBe('JOB:j1');
  });
});
