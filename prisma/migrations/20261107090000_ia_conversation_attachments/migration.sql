-- Recorded assessment conversations and their transcripts kept as initial assessment attachments.
ALTER TYPE "service_users"."InitialAssessmentAttachmentCategory" ADD VALUE IF NOT EXISTS 'CONVERSATION_RECORDING';
ALTER TYPE "service_users"."InitialAssessmentAttachmentCategory" ADD VALUE IF NOT EXISTS 'CONVERSATION_TRANSCRIPT';
