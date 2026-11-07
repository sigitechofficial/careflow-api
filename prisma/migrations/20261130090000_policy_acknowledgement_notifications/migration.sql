-- Policy read-and-acknowledge notifications. Additive only.
-- POLICY_ACKNOWLEDGEMENT_DUE: staff told about a new policy to read and reminded before/after the due date.
-- POLICY_ACKNOWLEDGEMENT_SUMMARY: weekly overdue summary for managers (policies.acknowledgements.manage).
-- Reminder state lives in PolicyAcknowledgement.metadata (no new table).

-- AlterEnum
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'POLICY_ACKNOWLEDGEMENT_DUE';
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'POLICY_ACKNOWLEDGEMENT_SUMMARY';

-- AlterEnum
ALTER TYPE "notifications"."NotificationModule" ADD VALUE IF NOT EXISTS 'POLICY';
