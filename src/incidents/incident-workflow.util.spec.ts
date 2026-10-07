import { IncidentStatus } from '@prisma/client';
import {
  canTransitionIncidentStatus,
  formatIncidentReference,
  INCIDENT_PRIVACY_RANK,
  isReopenTransition,
  isSendBackTransition,
  OPEN_INCIDENT_STATUSES,
} from './incident-workflow.util';

describe('incident workflow util', () => {
  describe('canTransitionIncidentStatus', () => {
    const can = canTransitionIncidentStatus;
    it('starts with a review: Reported → Under Review only', () => {
      expect(can(IncidentStatus.REPORTED, IncidentStatus.UNDER_REVIEW)).toBe(
        true,
      );
      expect(
        can(IncidentStatus.REPORTED, IncidentStatus.UNDER_INVESTIGATION),
      ).toBe(false);
      expect(can(IncidentStatus.REPORTED, IncidentStatus.CLOSED)).toBe(false);
    });

    it('lets a review lead to an investigation or straight to closure', () => {
      expect(
        can(IncidentStatus.UNDER_REVIEW, IncidentStatus.UNDER_INVESTIGATION),
      ).toBe(true);
      expect(
        can(IncidentStatus.UNDER_REVIEW, IncidentStatus.AWAITING_CLOSURE),
      ).toBe(true);
      expect(can(IncidentStatus.UNDER_REVIEW, IncidentStatus.CLOSED)).toBe(
        false,
      );
    });

    it('follows investigation → actions → awaiting closure → closed', () => {
      expect(
        can(
          IncidentStatus.UNDER_INVESTIGATION,
          IncidentStatus.ACTIONS_REQUIRED,
        ),
      ).toBe(true);
      expect(
        can(IncidentStatus.ACTIONS_REQUIRED, IncidentStatus.AWAITING_CLOSURE),
      ).toBe(true);
      expect(can(IncidentStatus.AWAITING_CLOSURE, IncidentStatus.CLOSED)).toBe(
        true,
      );
    });

    it('reopens a closed incident into Under Review only', () => {
      expect(can(IncidentStatus.CLOSED, IncidentStatus.UNDER_REVIEW)).toBe(
        true,
      );
      expect(
        can(IncidentStatus.CLOSED, IncidentStatus.UNDER_INVESTIGATION),
      ).toBe(false);
      expect(can(IncidentStatus.CLOSED, IncidentStatus.REOPENED)).toBe(false);
    });

    it('never moves to the legacy Reopened status', () => {
      for (const from of Object.values(IncidentStatus)) {
        expect(can(from, IncidentStatus.REOPENED)).toBe(false);
      }
    });

    it('never allows a no-op transition to the same status', () => {
      expect(
        can(IncidentStatus.UNDER_REVIEW, IncidentStatus.UNDER_REVIEW),
      ).toBe(false);
    });
  });

  describe('reopen / send-back helpers', () => {
    it('detects a reopen only from Closed to Under Review', () => {
      expect(
        isReopenTransition(IncidentStatus.CLOSED, IncidentStatus.UNDER_REVIEW),
      ).toBe(true);
      expect(
        isReopenTransition(
          IncidentStatus.REPORTED,
          IncidentStatus.UNDER_REVIEW,
        ),
      ).toBe(false);
    });

    it('detects a send-back to investigation from later stages', () => {
      expect(
        isSendBackTransition(
          IncidentStatus.AWAITING_CLOSURE,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
      expect(
        isSendBackTransition(
          IncidentStatus.ACTIONS_REQUIRED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
      expect(
        isSendBackTransition(
          IncidentStatus.UNDER_REVIEW,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(false);
    });
  });

  describe('formatIncidentReference', () => {
    it('zero-pads the sequence to six digits', () => {
      expect(formatIncidentReference(2026, 128)).toBe('INC-2026-000128');
      expect(formatIncidentReference(2026, 1)).toBe('INC-2026-000001');
    });
  });

  describe('privacy ranks', () => {
    it('orders normal < restricted < highly confidential', () => {
      expect(INCIDENT_PRIVACY_RANK.NORMAL).toBeLessThan(
        INCIDENT_PRIVACY_RANK.RESTRICTED,
      );
      expect(INCIDENT_PRIVACY_RANK.RESTRICTED).toBeLessThan(
        INCIDENT_PRIVACY_RANK.HIGHLY_CONFIDENTIAL,
      );
    });
  });

  describe('open statuses', () => {
    it('treats closed as not open', () => {
      expect(OPEN_INCIDENT_STATUSES).not.toContain(IncidentStatus.CLOSED);
      expect(OPEN_INCIDENT_STATUSES).toContain(
        IncidentStatus.UNDER_INVESTIGATION,
      );
    });
  });
});
