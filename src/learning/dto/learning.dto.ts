import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  LearningAssignmentPriority,
  LearningAssignmentType,
  LearningAttendanceStatus,
  LearningBookingStatus,
  LearningCompletionRule,
  LearningContentType,
  LearningCourseStatus,
  LearningCourseType,
  LearningDeliveryMethod,
  LearningDifficultyLevel,
  LearningPathwayStatus,
  LearningQuestionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Treat blank strings as undefined so optional date/uuid fields validate cleanly. */
function emptyToUndefined({ value }: { value: unknown }) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

/** Accept datetime-local (`YYYY-MM-DDTHH:mm`) by normalising to ISO-8601. */
function toIsoDateTime({ value }: { value: unknown }) {
  const cleared = emptyToUndefined({ value });
  if (cleared === undefined) return undefined;
  if (typeof cleared !== 'string') return cleared;
  const trimmed = cleared.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  return trimmed;
}

export class LearningListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Scope assignments to this location (assignment.locationId or employee employment locations)',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class CreateLearningCategoryDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class UpdateLearningCategoryDto extends PartialType(CreateLearningCategoryDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LearningCourseQueryDto extends LearningListQueryDto {
  @ApiPropertyOptional({ enum: LearningCourseStatus })
  @IsOptional()
  @IsEnum(LearningCourseStatus)
  status?: LearningCourseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateLearningCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: LearningCourseType })
  @IsOptional()
  @IsEnum(LearningCourseType)
  courseType?: LearningCourseType;

  @ApiPropertyOptional({ enum: LearningDeliveryMethod })
  @IsOptional()
  @IsEnum(LearningDeliveryMethod)
  deliveryMethod?: LearningDeliveryMethod;

  @ApiPropertyOptional({ enum: LearningDifficultyLevel })
  @IsOptional()
  @IsEnum(LearningDifficultyLevel)
  difficultyLevel?: LearningDifficultyLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cpdMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresAssessment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresPracticalAssessment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManagerApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresTrainingEvent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maximumAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  certificateEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  certificateValidityDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  refresherFrequencyDays?: number;
}

export class UpdateLearningCourseDto extends PartialType(CreateLearningCourseDto) {}

export class PublishLearningCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class CreateLearningCourseVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  versionLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class CreateLearningSectionDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estimatedDurationMinutes?: number;
}

export class UpdateLearningSectionDto extends PartialType(CreateLearningSectionDto) {}

export class CreateLearningContentItemDto {
  @ApiProperty({ enum: LearningContentType })
  @IsEnum(LearningContentType)
  contentType!: LearningContentType;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contentBody?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ enum: LearningCompletionRule })
  @IsOptional()
  @IsEnum(LearningCompletionRule)
  completionRule?: LearningCompletionRule;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  minimumTimeSpentSeconds?: number;
}

export class UpdateLearningContentItemDto extends PartialType(CreateLearningContentItemDto) {}

export class ReorderLearningSectionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  sectionIds!: string[];
}

export class CreateLearningAssessmentDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passingScore!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maximumAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  timeLimitMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  randomiseQuestions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  randomiseAnswers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class UpdateLearningAssessmentDto extends PartialType(CreateLearningAssessmentDto) {}

export class CreateAssessmentOptionDto {
  @ApiProperty()
  @IsString()
  optionText!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class CreateAssessmentQuestionDto {
  @ApiProperty({ enum: LearningQuestionType })
  @IsEnum(LearningQuestionType)
  questionType!: LearningQuestionType;

  @ApiProperty()
  @IsString()
  questionText!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  points?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ type: [CreateAssessmentOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAssessmentOptionDto)
  options?: CreateAssessmentOptionDto[];
}

export class UpdateAssessmentQuestionDto extends PartialType(CreateAssessmentQuestionDto) {}

export class CreateLearningPathwayDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetRoleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetWorkAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetLocationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  completionValidityDays?: number;
}

export class UpdateLearningPathwayDto extends PartialType(CreateLearningPathwayDto) {
  @ApiPropertyOptional({ enum: LearningPathwayStatus })
  @IsOptional()
  @IsEnum(LearningPathwayStatus)
  status?: LearningPathwayStatus;
}

export class CreatePathwayItemDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseVersionId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  dueDaysFromAssignment?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  prerequisiteItemId?: string;
}

export class UpdatePathwayItemDto extends PartialType(CreatePathwayItemDto) {}

export class CreateLearningAssignmentDto {
  @ApiProperty({ enum: LearningAssignmentType, default: LearningAssignmentType.INDIVIDUAL })
  @IsEnum(LearningAssignmentType)
  assignmentType!: LearningAssignmentType;

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  courseVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  pathwayId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  availableFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ enum: LearningAssignmentPriority })
  @IsOptional()
  @IsEnum(LearningAssignmentPriority)
  priority?: LearningAssignmentPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  assignmentReason?: string;
}

export class BulkLearningAssignmentDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  courseVersionId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  workAreaIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  assignmentReason?: string;
}

export class CancelAssignmentDto {
  @ApiProperty()
  @IsString()
  cancellationReason!: string;
}

export class ExtendDueDateDto {
  @ApiProperty()
  @IsDateString()
  dueAt!: string;
}

export class ExemptAssignmentDto {
  @ApiProperty()
  @IsString()
  exemptionReason!: string;
}

export class ReassignAssignmentDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class CompleteContentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  timeSpentSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  acknowledgementText?: string;
}

export class SubmitAssessmentAnswerDto {
  @ApiProperty()
  @IsUUID()
  questionId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  textAnswer?: string;
}

export class SubmitAssessmentAttemptDto {
  @ApiProperty({ type: [SubmitAssessmentAnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAssessmentAnswerDto)
  answers!: SubmitAssessmentAnswerDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  timeSpentSeconds?: number;
}

export class CreateCompetencyDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  validityDays?: number;
}

export class UpdateCompetencyDto extends PartialType(CreateCompetencyDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CompetencyCriterionResultDto {
  @ApiProperty()
  @IsString()
  criterion!: string;

  @ApiProperty()
  @IsString()
  result!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class CreateCompetencyAssessmentDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsUUID()
  competencyId!: string;

  @ApiProperty()
  @IsDateString()
  assessmentDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assessmentMethod?: string;

  @ApiPropertyOptional({ type: [CompetencyCriterionResultDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetencyCriterionResultDto)
  criterionResults?: CompetencyCriterionResultDto[];
}

export class ReviewCompetencyAssessmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assessorComments?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  improvementActions?: string;
}

export class RevokeCertificateDto {
  @ApiProperty()
  @IsString()
  revocationReason!: string;
}

export class IssueManualCertificateDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ description: 'Course to issue the certificate for' })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ description: 'Override expiry date (ISO). Leave blank to use course/settings validity.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Optional note explaining why this was issued manually' })
  @IsOptional()
  @IsString()
  issueNotes?: string;
}

export class VerifyCertificateDto {
  @ApiProperty()
  @IsString()
  verificationCode!: string;
}

export class CreateExternalTrainingDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsString()
  courseName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trainingProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualificationName?: string;

  @ApiProperty()
  @IsDateString()
  completedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cpdMinutes?: number;
}

export class UpdateExternalTrainingDto extends PartialType(CreateExternalTrainingDto) {}

export class VerifyExternalTrainingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}

export class RejectExternalTrainingDto {
  @ApiProperty()
  @IsString()
  verificationNotes!: string;
}

export class CreateTrainingEventDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trainerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  trainerEmployeeId?: string;

  @ApiPropertyOptional({ enum: LearningDeliveryMethod })
  @IsOptional()
  @IsEnum(LearningDeliveryMethod)
  deliveryMethod?: LearningDeliveryMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  virtualMeetingUrl?: string;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiProperty()
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  capacity?: number;
}

export class UpdateTrainingEventDto extends PartialType(CreateTrainingEventDto) {}

export class AddTrainingEventAttendeeDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ enum: LearningBookingStatus })
  @IsOptional()
  @IsEnum(LearningBookingStatus)
  bookingStatus?: LearningBookingStatus;
}

export class UpdateTrainingEventAttendeeDto {
  @ApiPropertyOptional({ enum: LearningBookingStatus })
  @IsOptional()
  @IsEnum(LearningBookingStatus)
  bookingStatus?: LearningBookingStatus;

  @ApiPropertyOptional({ enum: LearningAttendanceStatus })
  @IsOptional()
  @IsEnum(LearningAttendanceStatus)
  attendanceStatus?: LearningAttendanceStatus;
}

export class UpsertLearningSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  defaultExpiryWarningDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  defaultAssignmentDueDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowEmployeeExternalTrainingSubmission?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireManagerApprovalForExternalTraining?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticRefresherAssignment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticOverdueEscalation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  defaultCertificateValidityDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowCourseAccessAfterExpiry?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowCourseRetakeAfterPass?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complianceCalculationMode?: string;
}

export class LearningComplianceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class LearningCertificateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class LearningReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ManagerApprovalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
