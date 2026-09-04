import { BadRequestException } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';
import {
  assertDraftEditable,
  formatVersionLabel,
  nextStatus,
  nextVersionNumbers,
} from './policy-status';

describe('policy-status', () => {
  describe('nextStatus', () => {
    it('allows DRAFT → IN_REVIEW on submit', () => {
      expect(nextStatus(PolicyStatus.DRAFT, 'submit')).toBe(PolicyStatus.IN_REVIEW);
    });

    it('allows IN_REVIEW → DRAFT on request_changes', () => {
      expect(nextStatus(PolicyStatus.IN_REVIEW, 'request_changes')).toBe(PolicyStatus.DRAFT);
    });

    it('allows IN_REVIEW → APPROVED on approve', () => {
      expect(nextStatus(PolicyStatus.IN_REVIEW, 'approve')).toBe(PolicyStatus.APPROVED);
    });

    it('allows APPROVED → PUBLISHED on publish', () => {
      expect(nextStatus(PolicyStatus.APPROVED, 'publish')).toBe(PolicyStatus.PUBLISHED);
    });

    it('allows PUBLISHED → SUPERSEDED on supersede', () => {
      expect(nextStatus(PolicyStatus.PUBLISHED, 'supersede')).toBe(PolicyStatus.SUPERSEDED);
    });

    it('rejects DRAFT → PUBLISHED', () => {
      expect(() => nextStatus(PolicyStatus.DRAFT, 'publish')).toThrow(BadRequestException);
    });

    it('rejects IN_REVIEW → PUBLISHED', () => {
      expect(() => nextStatus(PolicyStatus.IN_REVIEW, 'publish')).toThrow(BadRequestException);
    });

    it('rejects PUBLISHED → DRAFT', () => {
      expect(() => nextStatus(PolicyStatus.PUBLISHED, 'request_changes')).toThrow(BadRequestException);
    });

    it('rejects APPROVED → IN_REVIEW', () => {
      expect(() => nextStatus(PolicyStatus.APPROVED, 'submit')).toThrow(BadRequestException);
    });

    it('rejects SUPERSEDED transitions', () => {
      expect(() => nextStatus(PolicyStatus.SUPERSEDED, 'publish')).toThrow(BadRequestException);
      expect(() => nextStatus(PolicyStatus.SUPERSEDED, 'archive')).toThrow(BadRequestException);
    });

    it('rejects a second archive', () => {
      expect(() => nextStatus(PolicyStatus.ARCHIVED, 'archive')).toThrow(BadRequestException);
    });
  });

  describe('assertDraftEditable', () => {
    it('allows DRAFT', () => {
      expect(() => assertDraftEditable(PolicyStatus.DRAFT)).not.toThrow();
    });

    it.each([
      PolicyStatus.IN_REVIEW,
      PolicyStatus.APPROVED,
      PolicyStatus.PUBLISHED,
      PolicyStatus.SUPERSEDED,
      PolicyStatus.ARCHIVED,
    ])('blocks editing %s', (status) => {
      expect(() => assertDraftEditable(status)).toThrow(BadRequestException);
    });
  });

  describe('version numbers', () => {
    it('starts labels at v1.0', () => {
      expect(formatVersionLabel(1, 0)).toBe('v1.0');
    });

    it('bumps minor 1.0 → 1.1 and 1.1 → 1.2', () => {
      expect(nextVersionNumbers(1, 0, 'minor')).toEqual({ versionMajor: 1, versionMinor: 1 });
      expect(nextVersionNumbers(1, 1, 'minor')).toEqual({ versionMajor: 1, versionMinor: 2 });
    });

    it('bumps major 1.2 → 2.0', () => {
      expect(nextVersionNumbers(1, 2, 'major')).toEqual({ versionMajor: 2, versionMinor: 0 });
    });
  });
});
