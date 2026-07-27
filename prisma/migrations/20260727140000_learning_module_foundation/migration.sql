-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "learning";

-- CreateEnum
CREATE TYPE "learning"."LearningCourseStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "learning"."LearningCourseType" AS ENUM ('COURSE', 'POLICY', 'ASSESSMENT', 'PRACTICAL_COMPETENCY', 'EXTERNAL_TRAINING', 'CLASSROOM', 'WEBINAR', 'BLENDED');

-- CreateEnum
CREATE TYPE "learning"."LearningDeliveryMethod" AS ENUM ('ONLINE', 'FACE_TO_FACE', 'VIRTUAL', 'WORKPLACE', 'BLENDED');

-- CreateEnum
CREATE TYPE "learning"."LearningDifficultyLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "learning"."LearningContentType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'EXTERNAL_LINK', 'CHECKLIST', 'SCENARIO', 'ACKNOWLEDGEMENT', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "learning"."LearningCompletionRule" AS ENUM ('OPEN', 'VIEW', 'ACKNOWLEDGE', 'DOWNLOAD', 'TIME_SPENT');

-- CreateEnum
CREATE TYPE "learning"."LearningQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_TEXT', 'LONG_TEXT');

-- CreateEnum
CREATE TYPE "learning"."LearningPathwayStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "learning"."LearningAssignmentType" AS ENUM ('INDIVIDUAL', 'BULK', 'ROLE_BASED', 'LOCATION_BASED', 'WORK_AREA_BASED', 'PATHWAY', 'AUTOMATIC', 'REFRESHER', 'INCIDENT_REMEDIAL');

-- CreateEnum
CREATE TYPE "learning"."LearningAssignmentStatus" AS ENUM ('ASSIGNED', 'NOT_STARTED', 'IN_PROGRESS', 'AWAITING_ASSESSMENT', 'AWAITING_APPROVAL', 'COMPLETED', 'PASSED', 'FAILED', 'OVERDUE', 'EXPIRED', 'CANCELLED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "learning"."LearningAssignmentPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "learning"."LearningProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_ASSESSMENT', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "learning"."LearningAssessmentResult" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED', 'AWAITING_MANUAL_REVIEW', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "learning"."LearningCompetencyOutcome" AS ENUM ('COMPETENT', 'COMPETENT_WITH_SUPERVISION', 'FURTHER_TRAINING_REQUIRED', 'NOT_COMPETENT', 'REASSESSMENT_REQUIRED');

-- CreateEnum
CREATE TYPE "learning"."LearningCompetencyAssessmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "learning"."LearningCertificateStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "learning"."LearningExternalVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "learning"."LearningTrainingEventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "learning"."LearningBookingStatus" AS ENUM ('INVITED', 'BOOKED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "learning"."LearningAttendanceStatus" AS ENUM ('INVITED', 'BOOKED', 'WAITLISTED', 'ATTENDED', 'PARTIALLY_ATTENDED', 'ABSENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "learning"."LearningNotificationEventType" AS ENUM ('ASSIGNMENT_CREATED', 'DUE_SOON', 'OVERDUE', 'CERTIFICATE_EXPIRING', 'CERTIFICATE_EXPIRED', 'ASSESSMENT_FAILED', 'COMPETENCY_REQUIRED', 'MANAGER_APPROVAL_REQUIRED', 'TRAINING_EVENT_REMINDER');

-- CreateEnum
CREATE TYPE "learning"."LearningNotificationRecipientType" AS ENUM ('EMPLOYEE', 'LINE_MANAGER', 'BRANCH_MANAGER', 'COMPLIANCE_MANAGER', 'ASSIGNER');

-- CreateEnum
CREATE TYPE "learning"."LearningNotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "learning"."LearningComplianceStatus" AS ENUM ('NOT_ASSIGNED', 'ASSIGNED', 'NOT_STARTED', 'IN_PROGRESS', 'AWAITING_ASSESSMENT', 'COMPLIANT', 'EXPIRING_SOON', 'EXPIRED', 'OVERDUE', 'EXEMPT', 'EXTERNAL_EVIDENCE');

-- AlterEnum
BEGIN;
CREATE TYPE "service_users"."BodyMapLinkedModule_new" AS ENUM ('CARE_PLAN', 'MAR', 'INCIDENT', 'RISK_ASSESSMENT', 'REFERRAL', 'CARE_NOTE');
ALTER TABLE "service_users"."BodyMapLink" ALTER COLUMN "linkedModule" TYPE "service_users"."BodyMapLinkedModule_new" USING ("linkedModule"::text::"service_users"."BodyMapLinkedModule_new");
ALTER TYPE "service_users"."BodyMapLinkedModule" RENAME TO "BodyMapLinkedModule_old";
ALTER TYPE "service_users"."BodyMapLinkedModule_new" RENAME TO "BodyMapLinkedModule";
DROP TYPE "service_users"."BodyMapLinkedModule_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "employees"."EmployeeEmploymentBaseLocation" DROP CONSTRAINT "EmployeeEmploymentBaseLocation_employmentId_fkey";

-- DropForeignKey
ALTER TABLE "employees"."EmployeeEmploymentBaseLocation" DROP CONSTRAINT "EmployeeEmploymentBaseLocation_locationId_fkey";

-- DropForeignKey
ALTER TABLE "service_users"."BodyMapRecord" DROP CONSTRAINT "BodyMapRecord_scheduledJobId_fkey";

-- DropForeignKey
ALTER TABLE "service_users"."BodyMapRecord" DROP CONSTRAINT "BodyMapRecord_scheduledVisitId_fkey";

-- DropForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" DROP CONSTRAINT "CarePlanAssessmentLink_completionId_fkey";

-- DropForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" DROP CONSTRAINT "CarePlanAssessmentLink_serviceUserId_fkey";

-- DropForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" DROP CONSTRAINT "ServiceUserAssessmentCompletion_assessmentId_fkey";

-- DropIndex
DROP INDEX "billing"."PayCard_code_key";

-- DropIndex
DROP INDEX "billing"."VisitReconciliation_scheduledVisitId_key";

-- DropIndex
DROP INDEX "employees"."EmployeePersonalDetail_ethnicityId_idx";

-- DropIndex
DROP INDEX "lookups"."ReviewType_code_key";

-- DropIndex
DROP INDEX "service_users"."BodyMapRecord_scheduledJobId_idx";

-- DropIndex
DROP INDEX "service_users"."BodyMapRecord_scheduledVisitId_idx";

-- DropIndex
DROP INDEX "service_users"."ServiceUserFunding_serviceUserId_splitPriority_idx";

-- AlterTable
ALTER TABLE "billing"."ChargeCard" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing"."ChargeCardRule" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing"."PayCard" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing"."PayCardRule" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "billing"."PayComponent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees"."EmployeeAbsenceRecord" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees"."EmployeeHoursMonthlyReview" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings" DROP COLUMN "domShowBlockedCarersInSchedule";

-- AlterTable
ALTER TABLE "lookups"."BankHoliday" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lookups"."CertificationType" DROP COLUMN "defaultValidityMonths";

-- AlterTable
ALTER TABLE "lookups"."ReviewType" DROP COLUMN "code",
DROP COLUMN "defaultIntervalDays",
DROP COLUMN "description";

-- AlterTable
ALTER TABLE "lookups"."SkillType" DROP COLUMN "defaultRefreshMonths";

-- AlterTable
ALTER TABLE "scheduling"."EcmAuditEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."EcmException" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."EcmNotificationEvidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."EcmScheduleVersion" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."EcmVisitEvaluation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."LateVisitAlertLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduling"."VisitAttendanceEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."BodyMapRecord" DROP COLUMN "scheduledJobId",
DROP COLUMN "scheduledVisitId";

-- AlterTable
ALTER TABLE "service_users"."CarePlanAssessmentLink" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserAssessment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserCarePlanDraft" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserCarePlanPublishedVersion" ALTER COLUMN "id" DROP DEFAULT;

-- DropTable
DROP TABLE "employees"."EmployeeEmploymentBaseLocation";

-- CreateTable
CREATE TABLE "learning"."LearningCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "LearningCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCourse" (
    "id" UUID NOT NULL,
    "categoryId" UUID,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "thumbnailFileId" UUID,
    "courseType" "learning"."LearningCourseType" NOT NULL DEFAULT 'COURSE',
    "deliveryMethod" "learning"."LearningDeliveryMethod" NOT NULL DEFAULT 'ONLINE',
    "difficultyLevel" "learning"."LearningDifficultyLevel" NOT NULL DEFAULT 'BEGINNER',
    "estimatedDurationMinutes" INTEGER,
    "cpdMinutes" INTEGER,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
    "requiresPracticalAssessment" BOOLEAN NOT NULL DEFAULT false,
    "requiresManagerApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiresTrainingEvent" BOOLEAN NOT NULL DEFAULT false,
    "passingScore" INTEGER,
    "maximumAttempts" INTEGER,
    "certificateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "certificateValidityDays" INTEGER,
    "refresherFrequencyDays" INTEGER,
    "effectiveFrom" DATE,
    "reviewDate" DATE,
    "status" "learning"."LearningCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" UUID,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "LearningCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCourseVersion" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "passingScore" INTEGER,
    "maximumAttempts" INTEGER,
    "estimatedDurationMinutes" INTEGER,
    "cpdMinutes" INTEGER,
    "certificateValidityDays" INTEGER,
    "refresherFrequencyDays" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "changeSummary" TEXT,
    "status" "learning"."LearningCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCourseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCourseSection" (
    "id" UUID NOT NULL,
    "courseVersionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "estimatedDurationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCourseSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningContentItem" (
    "id" UUID NOT NULL,
    "courseSectionId" UUID NOT NULL,
    "contentType" "learning"."LearningContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contentBody" TEXT,
    "fileId" UUID,
    "videoUrl" TEXT,
    "externalUrl" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationMinutes" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "completionRule" "learning"."LearningCompletionRule" NOT NULL DEFAULT 'VIEW',
    "minimumTimeSpentSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssessment" (
    "id" UUID NOT NULL,
    "courseVersionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "passingScore" INTEGER NOT NULL,
    "maximumAttempts" INTEGER,
    "timeLimitMinutes" INTEGER,
    "randomiseQuestions" BOOLEAN NOT NULL DEFAULT false,
    "randomiseAnswers" BOOLEAN NOT NULL DEFAULT false,
    "showCorrectAnswers" BOOLEAN NOT NULL DEFAULT false,
    "allowReview" BOOLEAN NOT NULL DEFAULT true,
    "retakeDelayMinutes" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssessmentQuestion" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "questionType" "learning"."LearningQuestionType" NOT NULL,
    "questionText" TEXT NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssessmentOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "optionText" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssessmentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningPathway" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "targetRoleId" UUID,
    "targetWorkAreaId" UUID,
    "targetLocationId" UUID,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "completionValidityDays" INTEGER,
    "status" "learning"."LearningPathwayStatus" NOT NULL DEFAULT 'DRAFT',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "LearningPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningPathwayItem" (
    "id" UUID NOT NULL,
    "pathwayId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "courseVersionId" UUID,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "dueDaysFromAssignment" INTEGER,
    "prerequisiteItemId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPathwayItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssignment" (
    "id" UUID NOT NULL,
    "assignmentType" "learning"."LearningAssignmentType" NOT NULL,
    "courseId" UUID NOT NULL,
    "courseVersionId" UUID,
    "pathwayId" UUID,
    "employeeId" UUID,
    "locationId" UUID,
    "workAreaId" UUID,
    "roleId" UUID,
    "parentAssignmentId" UUID,
    "refresherOfAssignmentId" UUID,
    "sourceEntityType" TEXT,
    "sourceEntityId" UUID,
    "assignedById" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableFrom" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "priority" "learning"."LearningAssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "assignmentReason" TEXT,
    "status" "learning"."LearningAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "exemptAt" TIMESTAMP(3),
    "exemptById" UUID,
    "exemptionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningEmployeeProgress" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "courseVersionId" UUID NOT NULL,
    "progressPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "completedContentItems" INTEGER NOT NULL DEFAULT 0,
    "totalRequiredContentItems" INTEGER NOT NULL DEFAULT 0,
    "assessmentStatus" "learning"."LearningProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "practicalAssessmentStatus" "learning"."LearningProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "managerApprovalStatus" "learning"."LearningProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "courseCompletionStatus" "learning"."LearningProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningEmployeeProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningContentItemCompletion" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "contentItemId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "acknowledgementText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningContentItemCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssessmentAttempt" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER,
    "percentage" DECIMAL(5,2),
    "result" "learning"."LearningAssessmentResult" NOT NULL DEFAULT 'IN_PROGRESS',
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssessmentAnswer" (
    "id" UUID NOT NULL,
    "assessmentAttemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionIds" UUID[],
    "textAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "pointsAwarded" INTEGER,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAssessmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCompetency" (
    "id" UUID NOT NULL,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "validityDays" INTEGER,
    "assessmentCriteria" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "LearningCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCompetencyAssessment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "assignmentId" UUID,
    "assessorEmployeeId" UUID,
    "assessorUserId" UUID,
    "assessmentDate" DATE NOT NULL,
    "location" TEXT,
    "assessmentMethod" TEXT,
    "outcome" "learning"."LearningCompetencyOutcome",
    "validFrom" DATE,
    "validUntil" DATE,
    "employeeComments" TEXT,
    "assessorComments" TEXT,
    "improvementActions" TEXT,
    "reassessmentDate" DATE,
    "evidenceFileId" UUID,
    "status" "learning"."LearningCompetencyAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCompetencyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCompetencyCriterionResult" (
    "id" UUID NOT NULL,
    "competencyAssessmentId" UUID NOT NULL,
    "criterion" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "comments" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCompetencyCriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningCertificate" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "courseVersionId" UUID NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "fileId" UUID,
    "verificationCode" TEXT NOT NULL,
    "status" "learning"."LearningCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedById" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revocationReason" TEXT,
    "supersededById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningExternalTraining" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "courseName" TEXT NOT NULL,
    "trainingProvider" TEXT,
    "qualificationName" TEXT,
    "certificateNumber" TEXT,
    "completedAt" DATE NOT NULL,
    "expiresAt" DATE,
    "cpdMinutes" INTEGER,
    "certificateFileId" UUID,
    "verificationStatus" "learning"."LearningExternalVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "verificationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "LearningExternalTraining_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningTrainingEvent" (
    "id" UUID NOT NULL,
    "courseId" UUID,
    "courseVersionId" UUID,
    "title" TEXT NOT NULL,
    "trainerName" TEXT,
    "trainerEmployeeId" UUID,
    "deliveryMethod" "learning"."LearningDeliveryMethod" NOT NULL DEFAULT 'FACE_TO_FACE',
    "location" TEXT,
    "virtualMeetingUrl" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "registrationDeadline" TIMESTAMP(3),
    "capacity" INTEGER,
    "status" "learning"."LearningTrainingEventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "LearningTrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningTrainingEventAttendee" (
    "id" UUID NOT NULL,
    "trainingEventId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "bookingStatus" "learning"."LearningBookingStatus" NOT NULL DEFAULT 'INVITED',
    "attendanceStatus" "learning"."LearningAttendanceStatus" NOT NULL DEFAULT 'INVITED',
    "assessmentResult" "learning"."LearningAssessmentResult",
    "completedAt" TIMESTAMP(3),
    "certificateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningTrainingEventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningAssignmentRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" "learning"."LearningAssignmentType" NOT NULL,
    "courseId" UUID,
    "pathwayId" UUID,
    "roleId" UUID,
    "locationId" UUID,
    "workAreaId" UUID,
    "employmentType" TEXT,
    "employeeStartDateTrigger" BOOLEAN NOT NULL DEFAULT false,
    "serviceCapabilityRequirement" TEXT,
    "dueDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "LearningAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningNotificationRule" (
    "id" UUID NOT NULL,
    "eventType" "learning"."LearningNotificationEventType" NOT NULL,
    "daysBeforeDue" INTEGER,
    "daysAfterDue" INTEGER,
    "recipientType" "learning"."LearningNotificationRecipientType" NOT NULL,
    "channel" "learning"."LearningNotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningNotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningSettings" (
    "id" UUID NOT NULL,
    "defaultExpiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "defaultAssignmentDueDays" INTEGER NOT NULL DEFAULT 14,
    "allowEmployeeExternalTrainingSubmission" BOOLEAN NOT NULL DEFAULT true,
    "requireManagerApprovalForExternalTraining" BOOLEAN NOT NULL DEFAULT false,
    "automaticRefresherAssignment" BOOLEAN NOT NULL DEFAULT true,
    "automaticOverdueEscalation" BOOLEAN NOT NULL DEFAULT true,
    "defaultCertificateValidityDays" INTEGER NOT NULL DEFAULT 365,
    "allowCourseAccessAfterExpiry" BOOLEAN NOT NULL DEFAULT false,
    "allowCourseRetakeAfterPass" BOOLEAN NOT NULL DEFAULT false,
    "complianceCalculationMode" TEXT NOT NULL DEFAULT 'HYBRID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LearningSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning"."LearningComplianceSnapshot" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "complianceStatus" "learning"."LearningComplianceStatus" NOT NULL DEFAULT 'NOT_ASSIGNED',
    "assignmentId" UUID,
    "courseVersionId" UUID,
    "certificateId" UUID,
    "externalTrainingId" UUID,
    "competencyAssessmentId" UUID,
    "dueAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusReason" TEXT,
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningComplianceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningCategory_deletedAt_idx" ON "learning"."LearningCategory"("deletedAt");

-- CreateIndex
CREATE INDEX "LearningCategory_isActive_idx" ON "learning"."LearningCategory"("isActive");

-- CreateIndex
CREATE INDEX "LearningCategory_displayOrder_idx" ON "learning"."LearningCategory"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCategory_code_key" ON "learning"."LearningCategory"("code");

-- CreateIndex
CREATE INDEX "LearningCourse_categoryId_idx" ON "learning"."LearningCourse"("categoryId");

-- CreateIndex
CREATE INDEX "LearningCourse_status_idx" ON "learning"."LearningCourse"("status");

-- CreateIndex
CREATE INDEX "LearningCourse_courseType_idx" ON "learning"."LearningCourse"("courseType");

-- CreateIndex
CREATE INDEX "LearningCourse_deliveryMethod_idx" ON "learning"."LearningCourse"("deliveryMethod");

-- CreateIndex
CREATE INDEX "LearningCourse_isMandatory_idx" ON "learning"."LearningCourse"("isMandatory");

-- CreateIndex
CREATE INDEX "LearningCourse_reviewDate_idx" ON "learning"."LearningCourse"("reviewDate");

-- CreateIndex
CREATE INDEX "LearningCourse_deletedAt_idx" ON "learning"."LearningCourse"("deletedAt");

-- CreateIndex
CREATE INDEX "LearningCourse_archivedAt_idx" ON "learning"."LearningCourse"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCourse_code_key" ON "learning"."LearningCourse"("code");

-- CreateIndex
CREATE INDEX "LearningCourseVersion_courseId_idx" ON "learning"."LearningCourseVersion"("courseId");

-- CreateIndex
CREATE INDEX "LearningCourseVersion_status_idx" ON "learning"."LearningCourseVersion"("status");

-- CreateIndex
CREATE INDEX "LearningCourseVersion_publishedAt_idx" ON "learning"."LearningCourseVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCourseVersion_courseId_versionNumber_key" ON "learning"."LearningCourseVersion"("courseId", "versionNumber");

-- CreateIndex
CREATE INDEX "LearningCourseSection_courseVersionId_idx" ON "learning"."LearningCourseSection"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningCourseSection_displayOrder_idx" ON "learning"."LearningCourseSection"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningContentItem_courseSectionId_idx" ON "learning"."LearningContentItem"("courseSectionId");

-- CreateIndex
CREATE INDEX "LearningContentItem_contentType_idx" ON "learning"."LearningContentItem"("contentType");

-- CreateIndex
CREATE INDEX "LearningContentItem_displayOrder_idx" ON "learning"."LearningContentItem"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningAssessment_courseVersionId_idx" ON "learning"."LearningAssessment"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningAssessmentQuestion_assessmentId_idx" ON "learning"."LearningAssessmentQuestion"("assessmentId");

-- CreateIndex
CREATE INDEX "LearningAssessmentQuestion_displayOrder_idx" ON "learning"."LearningAssessmentQuestion"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningAssessmentOption_questionId_idx" ON "learning"."LearningAssessmentOption"("questionId");

-- CreateIndex
CREATE INDEX "LearningAssessmentOption_displayOrder_idx" ON "learning"."LearningAssessmentOption"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningPathway_status_idx" ON "learning"."LearningPathway"("status");

-- CreateIndex
CREATE INDEX "LearningPathway_targetRoleId_idx" ON "learning"."LearningPathway"("targetRoleId");

-- CreateIndex
CREATE INDEX "LearningPathway_targetWorkAreaId_idx" ON "learning"."LearningPathway"("targetWorkAreaId");

-- CreateIndex
CREATE INDEX "LearningPathway_targetLocationId_idx" ON "learning"."LearningPathway"("targetLocationId");

-- CreateIndex
CREATE INDEX "LearningPathway_deletedAt_idx" ON "learning"."LearningPathway"("deletedAt");

-- CreateIndex
CREATE INDEX "LearningPathway_archivedAt_idx" ON "learning"."LearningPathway"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathway_code_key" ON "learning"."LearningPathway"("code");

-- CreateIndex
CREATE INDEX "LearningPathwayItem_pathwayId_idx" ON "learning"."LearningPathwayItem"("pathwayId");

-- CreateIndex
CREATE INDEX "LearningPathwayItem_courseId_idx" ON "learning"."LearningPathwayItem"("courseId");

-- CreateIndex
CREATE INDEX "LearningPathwayItem_courseVersionId_idx" ON "learning"."LearningPathwayItem"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningPathwayItem_prerequisiteItemId_idx" ON "learning"."LearningPathwayItem"("prerequisiteItemId");

-- CreateIndex
CREATE INDEX "LearningPathwayItem_displayOrder_idx" ON "learning"."LearningPathwayItem"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningAssignment_courseId_idx" ON "learning"."LearningAssignment"("courseId");

-- CreateIndex
CREATE INDEX "LearningAssignment_courseVersionId_idx" ON "learning"."LearningAssignment"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningAssignment_pathwayId_idx" ON "learning"."LearningAssignment"("pathwayId");

-- CreateIndex
CREATE INDEX "LearningAssignment_employeeId_idx" ON "learning"."LearningAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "LearningAssignment_locationId_idx" ON "learning"."LearningAssignment"("locationId");

-- CreateIndex
CREATE INDEX "LearningAssignment_workAreaId_idx" ON "learning"."LearningAssignment"("workAreaId");

-- CreateIndex
CREATE INDEX "LearningAssignment_roleId_idx" ON "learning"."LearningAssignment"("roleId");

-- CreateIndex
CREATE INDEX "LearningAssignment_assignmentType_idx" ON "learning"."LearningAssignment"("assignmentType");

-- CreateIndex
CREATE INDEX "LearningAssignment_status_idx" ON "learning"."LearningAssignment"("status");

-- CreateIndex
CREATE INDEX "LearningAssignment_dueAt_idx" ON "learning"."LearningAssignment"("dueAt");

-- CreateIndex
CREATE INDEX "LearningAssignment_assignedAt_idx" ON "learning"."LearningAssignment"("assignedAt");

-- CreateIndex
CREATE INDEX "LearningAssignment_parentAssignmentId_idx" ON "learning"."LearningAssignment"("parentAssignmentId");

-- CreateIndex
CREATE INDEX "LearningAssignment_sourceEntityType_sourceEntityId_idx" ON "learning"."LearningAssignment"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEmployeeProgress_assignmentId_key" ON "learning"."LearningEmployeeProgress"("assignmentId");

-- CreateIndex
CREATE INDEX "LearningEmployeeProgress_employeeId_idx" ON "learning"."LearningEmployeeProgress"("employeeId");

-- CreateIndex
CREATE INDEX "LearningEmployeeProgress_courseVersionId_idx" ON "learning"."LearningEmployeeProgress"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningEmployeeProgress_courseCompletionStatus_idx" ON "learning"."LearningEmployeeProgress"("courseCompletionStatus");

-- CreateIndex
CREATE INDEX "LearningContentItemCompletion_employeeId_idx" ON "learning"."LearningContentItemCompletion"("employeeId");

-- CreateIndex
CREATE INDEX "LearningContentItemCompletion_contentItemId_idx" ON "learning"."LearningContentItemCompletion"("contentItemId");

-- CreateIndex
CREATE INDEX "LearningContentItemCompletion_completedAt_idx" ON "learning"."LearningContentItemCompletion"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningContentItemCompletion_assignmentId_contentItemId_key" ON "learning"."LearningContentItemCompletion"("assignmentId", "contentItemId");

-- CreateIndex
CREATE INDEX "LearningAssessmentAttempt_employeeId_idx" ON "learning"."LearningAssessmentAttempt"("employeeId");

-- CreateIndex
CREATE INDEX "LearningAssessmentAttempt_result_idx" ON "learning"."LearningAssessmentAttempt"("result");

-- CreateIndex
CREATE INDEX "LearningAssessmentAttempt_submittedAt_idx" ON "learning"."LearningAssessmentAttempt"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningAssessmentAttempt_assessmentId_assignmentId_attempt_key" ON "learning"."LearningAssessmentAttempt"("assessmentId", "assignmentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "LearningAssessmentAnswer_questionId_idx" ON "learning"."LearningAssessmentAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningAssessmentAnswer_assessmentAttemptId_questionId_key" ON "learning"."LearningAssessmentAnswer"("assessmentAttemptId", "questionId");

-- CreateIndex
CREATE INDEX "LearningCompetency_categoryId_idx" ON "learning"."LearningCompetency"("categoryId");

-- CreateIndex
CREATE INDEX "LearningCompetency_isActive_idx" ON "learning"."LearningCompetency"("isActive");

-- CreateIndex
CREATE INDEX "LearningCompetency_deletedAt_idx" ON "learning"."LearningCompetency"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCompetency_code_key" ON "learning"."LearningCompetency"("code");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_employeeId_idx" ON "learning"."LearningCompetencyAssessment"("employeeId");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_competencyId_idx" ON "learning"."LearningCompetencyAssessment"("competencyId");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_assignmentId_idx" ON "learning"."LearningCompetencyAssessment"("assignmentId");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_assessorEmployeeId_idx" ON "learning"."LearningCompetencyAssessment"("assessorEmployeeId");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_status_idx" ON "learning"."LearningCompetencyAssessment"("status");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_validUntil_idx" ON "learning"."LearningCompetencyAssessment"("validUntil");

-- CreateIndex
CREATE INDEX "LearningCompetencyAssessment_assessmentDate_idx" ON "learning"."LearningCompetencyAssessment"("assessmentDate");

-- CreateIndex
CREATE INDEX "LearningCompetencyCriterionResult_competencyAssessmentId_idx" ON "learning"."LearningCompetencyCriterionResult"("competencyAssessmentId");

-- CreateIndex
CREATE INDEX "LearningCompetencyCriterionResult_displayOrder_idx" ON "learning"."LearningCompetencyCriterionResult"("displayOrder");

-- CreateIndex
CREATE INDEX "LearningCertificate_employeeId_idx" ON "learning"."LearningCertificate"("employeeId");

-- CreateIndex
CREATE INDEX "LearningCertificate_courseId_idx" ON "learning"."LearningCertificate"("courseId");

-- CreateIndex
CREATE INDEX "LearningCertificate_courseVersionId_idx" ON "learning"."LearningCertificate"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningCertificate_status_idx" ON "learning"."LearningCertificate"("status");

-- CreateIndex
CREATE INDEX "LearningCertificate_expiresAt_idx" ON "learning"."LearningCertificate"("expiresAt");

-- CreateIndex
CREATE INDEX "LearningCertificate_issuedAt_idx" ON "learning"."LearningCertificate"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCertificate_certificateNumber_key" ON "learning"."LearningCertificate"("certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCertificate_verificationCode_key" ON "learning"."LearningCertificate"("verificationCode");

-- CreateIndex
CREATE INDEX "LearningExternalTraining_employeeId_idx" ON "learning"."LearningExternalTraining"("employeeId");

-- CreateIndex
CREATE INDEX "LearningExternalTraining_verificationStatus_idx" ON "learning"."LearningExternalTraining"("verificationStatus");

-- CreateIndex
CREATE INDEX "LearningExternalTraining_expiresAt_idx" ON "learning"."LearningExternalTraining"("expiresAt");

-- CreateIndex
CREATE INDEX "LearningExternalTraining_completedAt_idx" ON "learning"."LearningExternalTraining"("completedAt");

-- CreateIndex
CREATE INDEX "LearningExternalTraining_deletedAt_idx" ON "learning"."LearningExternalTraining"("deletedAt");

-- CreateIndex
CREATE INDEX "LearningTrainingEvent_courseId_idx" ON "learning"."LearningTrainingEvent"("courseId");

-- CreateIndex
CREATE INDEX "LearningTrainingEvent_courseVersionId_idx" ON "learning"."LearningTrainingEvent"("courseVersionId");

-- CreateIndex
CREATE INDEX "LearningTrainingEvent_status_idx" ON "learning"."LearningTrainingEvent"("status");

-- CreateIndex
CREATE INDEX "LearningTrainingEvent_startAt_idx" ON "learning"."LearningTrainingEvent"("startAt");

-- CreateIndex
CREATE INDEX "LearningTrainingEvent_endAt_idx" ON "learning"."LearningTrainingEvent"("endAt");

-- CreateIndex
CREATE INDEX "LearningTrainingEventAttendee_employeeId_idx" ON "learning"."LearningTrainingEventAttendee"("employeeId");

-- CreateIndex
CREATE INDEX "LearningTrainingEventAttendee_bookingStatus_idx" ON "learning"."LearningTrainingEventAttendee"("bookingStatus");

-- CreateIndex
CREATE INDEX "LearningTrainingEventAttendee_attendanceStatus_idx" ON "learning"."LearningTrainingEventAttendee"("attendanceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTrainingEventAttendee_trainingEventId_employeeId_key" ON "learning"."LearningTrainingEventAttendee"("trainingEventId", "employeeId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_ruleType_idx" ON "learning"."LearningAssignmentRule"("ruleType");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_courseId_idx" ON "learning"."LearningAssignmentRule"("courseId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_pathwayId_idx" ON "learning"."LearningAssignmentRule"("pathwayId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_roleId_idx" ON "learning"."LearningAssignmentRule"("roleId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_locationId_idx" ON "learning"."LearningAssignmentRule"("locationId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_workAreaId_idx" ON "learning"."LearningAssignmentRule"("workAreaId");

-- CreateIndex
CREATE INDEX "LearningAssignmentRule_isActive_idx" ON "learning"."LearningAssignmentRule"("isActive");

-- CreateIndex
CREATE INDEX "LearningNotificationRule_eventType_idx" ON "learning"."LearningNotificationRule"("eventType");

-- CreateIndex
CREATE INDEX "LearningNotificationRule_recipientType_idx" ON "learning"."LearningNotificationRule"("recipientType");

-- CreateIndex
CREATE INDEX "LearningNotificationRule_isActive_idx" ON "learning"."LearningNotificationRule"("isActive");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_employeeId_idx" ON "learning"."LearningComplianceSnapshot"("employeeId");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_courseId_idx" ON "learning"."LearningComplianceSnapshot"("courseId");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_complianceStatus_idx" ON "learning"."LearningComplianceSnapshot"("complianceStatus");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_expiresAt_idx" ON "learning"."LearningComplianceSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_dueAt_idx" ON "learning"."LearningComplianceSnapshot"("dueAt");

-- CreateIndex
CREATE INDEX "LearningComplianceSnapshot_lastCalculatedAt_idx" ON "learning"."LearningComplianceSnapshot"("lastCalculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningComplianceSnapshot_employeeId_courseId_key" ON "learning"."LearningComplianceSnapshot"("employeeId", "courseId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ADD CONSTRAINT "ServiceUserAssessmentCompletion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "service_users"."ServiceUserAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD CONSTRAINT "CarePlanAssessmentLink_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "service_users"."ServiceUserAssessmentCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_carePathwayFormId_fkey" FOREIGN KEY ("carePathwayFormId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_carePathwayFormVersionId_fkey" FOREIGN KEY ("carePathwayFormVersionId") REFERENCES "care_pathway"."CarePathwayFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCourse" ADD CONSTRAINT "LearningCourse_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "learning"."LearningCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCourseVersion" ADD CONSTRAINT "LearningCourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCourseSection" ADD CONSTRAINT "LearningCourseSection_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningContentItem" ADD CONSTRAINT "LearningContentItem_courseSectionId_fkey" FOREIGN KEY ("courseSectionId") REFERENCES "learning"."LearningCourseSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessment" ADD CONSTRAINT "LearningAssessment_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentQuestion" ADD CONSTRAINT "LearningAssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "learning"."LearningAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentOption" ADD CONSTRAINT "LearningAssessmentOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning"."LearningAssessmentQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningPathwayItem" ADD CONSTRAINT "LearningPathwayItem_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "learning"."LearningPathway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningPathwayItem" ADD CONSTRAINT "LearningPathwayItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningPathwayItem" ADD CONSTRAINT "LearningPathwayItem_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningPathwayItem" ADD CONSTRAINT "LearningPathwayItem_prerequisiteItemId_fkey" FOREIGN KEY ("prerequisiteItemId") REFERENCES "learning"."LearningPathwayItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignment" ADD CONSTRAINT "LearningAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignment" ADD CONSTRAINT "LearningAssignment_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignment" ADD CONSTRAINT "LearningAssignment_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "learning"."LearningPathway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignment" ADD CONSTRAINT "LearningAssignment_parentAssignmentId_fkey" FOREIGN KEY ("parentAssignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningEmployeeProgress" ADD CONSTRAINT "LearningEmployeeProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningEmployeeProgress" ADD CONSTRAINT "LearningEmployeeProgress_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningContentItemCompletion" ADD CONSTRAINT "LearningContentItemCompletion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningContentItemCompletion" ADD CONSTRAINT "LearningContentItemCompletion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "learning"."LearningContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentAttempt" ADD CONSTRAINT "LearningAssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "learning"."LearningAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentAttempt" ADD CONSTRAINT "LearningAssessmentAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentAnswer" ADD CONSTRAINT "LearningAssessmentAnswer_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "learning"."LearningAssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssessmentAnswer" ADD CONSTRAINT "LearningAssessmentAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "learning"."LearningAssessmentQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCompetency" ADD CONSTRAINT "LearningCompetency_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "learning"."LearningCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCompetencyAssessment" ADD CONSTRAINT "LearningCompetencyAssessment_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "learning"."LearningCompetency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCompetencyAssessment" ADD CONSTRAINT "LearningCompetencyAssessment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCompetencyCriterionResult" ADD CONSTRAINT "LearningCompetencyCriterionResult_competencyAssessmentId_fkey" FOREIGN KEY ("competencyAssessmentId") REFERENCES "learning"."LearningCompetencyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCertificate" ADD CONSTRAINT "LearningCertificate_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCertificate" ADD CONSTRAINT "LearningCertificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningCertificate" ADD CONSTRAINT "LearningCertificate_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningTrainingEvent" ADD CONSTRAINT "LearningTrainingEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningTrainingEvent" ADD CONSTRAINT "LearningTrainingEvent_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "learning"."LearningCourseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningTrainingEventAttendee" ADD CONSTRAINT "LearningTrainingEventAttendee_trainingEventId_fkey" FOREIGN KEY ("trainingEventId") REFERENCES "learning"."LearningTrainingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningTrainingEventAttendee" ADD CONSTRAINT "LearningTrainingEventAttendee_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "learning"."LearningCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignmentRule" ADD CONSTRAINT "LearningAssignmentRule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningAssignmentRule" ADD CONSTRAINT "LearningAssignmentRule_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "learning"."LearningPathway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning"."LearningComplianceSnapshot" ADD CONSTRAINT "LearningComplianceSnapshot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "learning"."LearningCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "billing"."InvoiceRunLine_invoiceRunId_visitReconciliationId_serviceUserFu" RENAME TO "InvoiceRunLine_invoiceRunId_visitReconciliationId_serviceUs_key";

-- RenameIndex
ALTER INDEX "scheduling"."sched_visit_task_job_assignment_key" RENAME TO "ScheduledVisitTaskCompletion_scheduledJobId_assignmentId_key";

-- RenameIndex
ALTER INDEX "service_users"."ServiceUserCarePlanPublishedVersion_instanceId_versionNumber_ke" RENAME TO "ServiceUserCarePlanPublishedVersion_instanceId_versionNumbe_key";

-- RenameIndex
ALTER INDEX "service_users"."su_visit_task_assign_su_round_idx" RENAME TO "ServiceUserVisitTaskAssignment_serviceUserId_medicationRoun_idx";

-- RenameIndex
ALTER INDEX "service_users"."su_visit_task_assign_su_round_task_key" RENAME TO "ServiceUserVisitTaskAssignment_serviceUserId_medicationRoun_key";

-- RenameIndex
ALTER INDEX "service_users"."VisitPlanSlotException_visitPlanSlotId_exceptionDate_exceptionT" RENAME TO "VisitPlanSlotException_visitPlanSlotId_exceptionDate_except_key";
