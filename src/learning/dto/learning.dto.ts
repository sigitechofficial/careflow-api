import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
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
  IsNotEmpty,
  MaxLength,
  ValidateIf,
  ArrayNotEmpty,
  ArrayMaxSize,
  MinLength,
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

  /** Assignments list (17 Nov 2026): only courses given from another record, e.g. INCIDENT. */
  @ApiPropertyOptional({ enum: ['INCIDENT'] })
  @IsOptional()
  @IsEnum(['INCIDENT'])
  source?: 'INCIDENT';

  /** Assignments list: one carer and/or one course (used by the incident course measure). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;
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
  /** Required for new courses (PartialType keeps it optional on update). */
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'SAFEGUARDING-001' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;

  @ApiPropertyOptional({
    description:
      'What the learner should know or be able to do. Stored on the draft version.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  learningObjectives?: string;

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
  @Min(1)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  cpdMinutes?: number | null;

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

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    description: 'Days a certificate stays valid. Null = the Learning settings default (defaultCertificateValidityDays).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  certificateValidityDays?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Set = a refresher is assigned when the certificate expires; null = none',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  refresherFrequencyDays?: number | null;
}

export class UpdateLearningCourseDto extends PartialType(
  CreateLearningCourseDto,
) {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Practical competency linked to the draft version; null removes it',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  competencyId?: string | null;
}

export class PublishLearningCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changeSummary?: string;

  @ApiPropertyOptional({
    description:
      'Withdrawn course only: re-activate it in the same step, so new assignments get this version',
  })
  @IsOptional()
  @IsBoolean()
  reactivate?: boolean;
}

export class SuggestCourseCodeQueryDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;
}

export class WithdrawLearningCourseDto {
  @ApiProperty({
    description:
      'Why the course is withdrawn from new assignments (kept in the audit log).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
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

  @ApiPropertyOptional({
    nullable: true,
    description: 'Rough time for the carer, in minutes',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  estimatedDurationMinutes?: number | null;
}

export class UpdateLearningContentItemDto extends PartialType(CreateLearningContentItemDto) {}

export class ReorderLearningSectionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  sectionIds!: string[];
}

export class ReorderLearningContentDto {
  @ApiProperty({
    type: [String],
    description: 'Every lesson id of the section, in the new order',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  contentIds!: string[];
}

export class MoveLearningContentDto {
  @ApiProperty({
    description:
      'Section (same draft version) to move the lesson to; it goes to the end',
  })
  @IsUUID()
  sectionId!: string;
}

export class CreateLearningAssessmentDto {
  @ApiPropertyOptional({
    description:
      'Module (course section) of the same draft version; leave out for a final assessment',
  })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  passingScore!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Null = no limit' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumAttempts?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Minutes to wait before another attempt; null = no wait',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  retakeDelayMinutes?: number | null;

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

export class UpdateLearningAssessmentDto extends PartialType(
  OmitType(CreateLearningAssessmentDto, ['sectionId'] as const),
) {}

export class CreateAssessmentOptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
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
  @MaxLength(1000)
  questionText!: string;

  @ApiPropertyOptional({ description: 'Shown to the carer after answering' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  explanation?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
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

export class ReorderAssessmentQuestionsDto {
  @ApiProperty({
    type: [String],
    description: 'Every question id of the quiz, in the new order',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  questionIds!: string[];
}

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

export class EmployeeDueDateDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @Transform(toIsoDateTime)
  @IsDateString()
  dueAt!: string;
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

  /** Own due date per chosen carer (13 Nov 2026); others get `dueAt` or the settings default. */
  @ApiPropertyOptional({ type: () => [EmployeeDueDateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => EmployeeDueDateDto)
  employeeDueDates?: EmployeeDueDateDto[];
}

export class CancelAssignmentDto {
  @ApiProperty()
  @IsString()
  cancellationReason!: string;
}

/** Edit an open assignment before its due date (18 Nov 2026). Course and carer only before it is started. */
export class UpdateAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'Why it was changed (optional)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  validityDays?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Checklist the assessor signs off',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  assessmentCriteria?: string[];
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

  @ApiPropertyOptional({ description: 'Role that gets Learning tasks in My tasks; null = Admin' })
  @IsOptional()
  @IsUUID()
  taskRoleId?: string | null;
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

  /** Certificates page tabs (17 Nov 2026). Expired also covers an active one past its date. */
  @ApiPropertyOptional({ enum: ['ACTIVE', 'EXPIRED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'EXPIRED'])
  status?: 'ACTIVE' | 'EXPIRED';

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

/** Carer app: "Can't attend" a training session (13 Nov 2026). */
export class CantAttendSessionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** New due date with a reason (overdue review, 16 Nov 2026). */
export class ExtendAssignmentWithReasonDto {
  @ApiProperty()
  @Transform(toIsoDateTime)
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reasonCode?: string;

  @ApiProperty({ description: 'Why the due date is extended' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  policyVersionId?: string;
}

/** Reason / actions for an overdue or late course, or mark it not completed (16 Nov 2026). */
export class RecordAssignmentReviewDto {
  @ApiProperty({ enum: ['REASON', 'NOT_COMPLETED'] })
  @IsEnum(['REASON', 'NOT_COMPLETED'])
  kind!: 'REASON' | 'NOT_COMPLETED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reasonCode?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  actionCodes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  followUpAt?: string;

  @ApiPropertyOptional({ description: 'Re-assign the course with this due date (NOT_COMPLETED only)' })
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  reassignDueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  policyVersionId?: string;
}

/** Carer app: why an overdue course is late (16 Nov 2026). */
export class CarerLateReasonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Assignments list with a status tab (16 Nov 2026). */
export class LearningAssignmentListQueryDto extends LearningListQueryDto {
  @ApiPropertyOptional({
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED', 'NOT_COMPLETED', 'NOT_PASSED', 'INCOMPLETE', 'CANCELLED'],
  })
  @IsOptional()
  @IsEnum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED', 'NOT_COMPLETED', 'NOT_PASSED', 'INCOMPLETE', 'CANCELLED'])
  statusGroup?:
    | 'OPEN'
    | 'ASSIGNED'
    | 'IN_PROGRESS'
    | 'OVERDUE'
    | 'COMPLETED'
    | 'NOT_COMPLETED'
    | 'NOT_PASSED'
    | 'INCOMPLETE'
    | 'CANCELLED';
}

/** Manager outcome for a face to face / workplace course (16 Nov 2026). */
export class RecordOutcomeDto {
  /** PASSED_AFTER_QUIZ: practical passed, the course completes when the carer passes the quiz. */
  @ApiProperty({ enum: ['PASSED', 'PASSED_AFTER_QUIZ', 'NOT_PASSED'] })
  @IsEnum(['PASSED', 'PASSED_AFTER_QUIZ', 'NOT_PASSED'])
  result!: 'PASSED' | 'PASSED_AFTER_QUIZ' | 'NOT_PASSED';

  @ApiPropertyOptional({ description: 'Required (3+ chars) when not passed' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: 'Not passed: give the course again with this due date' })
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  reassignDueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  policyVersionId?: string;
}

/** One checklist point of a practical test (17 Nov 2026). */
export class PracticalCriterionResultDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  criterion!: string;

  @ApiProperty()
  @IsBoolean()
  met!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/**
 * Practical test sign-off (17 Nov 2026): whoever is logged in to the admin with
 * learning.assignments.manage watches the carer and fills the checklist. One step.
 */
export class PracticalSignoffDto {
  @ApiProperty({ description: 'Date the carer was observed (YYYY-MM-DD)' })
  @IsDateString()
  assessmentDate!: string;

  @ApiPropertyOptional({ description: 'Where / how it was observed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @ApiProperty({ type: [PracticalCriterionResultDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PracticalCriterionResultDto)
  results!: PracticalCriterionResultDto[];

  @ApiProperty({ description: 'Competent (pass) or not yet competent (fail)' })
  @IsBoolean()
  competent!: boolean;

  @ApiPropertyOptional({ description: 'Required (3+ chars) when not competent' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nextSteps?: string;

  @ApiPropertyOptional({ description: 'Not competent: give the course again with this due date' })
  @IsOptional()
  @Transform(toIsoDateTime)
  @IsDateString()
  reassignDueAt?: string;
}

/** Face to face: the office marks lessons done (16 Nov 2026). Empty lessonIds = all lessons. */
export class MarkLessonsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  lessonIds?: string[];

  @ApiProperty()
  @IsBoolean()
  done!: boolean;
}

/** Give a failed / not completed course again (16 Nov 2026). */
export class AssignAgainDto {
  @ApiProperty()
  @Transform(toIsoDateTime)
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
