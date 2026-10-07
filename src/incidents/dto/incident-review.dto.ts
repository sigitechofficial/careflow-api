import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentExternalInvestigationType,
  IncidentInvestigationScope,
  IncidentPreventability,
  IncidentSeverity,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  INCIDENT_CONTRIBUTING_FACTORS,
  INVESTIGATION_RECORDS_REVIEWED,
} from '../incident-review.constants';
import { INVESTIGATION_LEVELS, INVESTIGATOR_INVOLVEMENT } from '../incident-investigation.util';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class UpsertIncidentReviewDto {
  @ApiPropertyOptional({
    enum: IncidentSeverity,
    description:
      "The manager's severity decision. Required on the first review; the same value as the incident's severity confirms it, a different one changes it (needs severityReason). Later a different value changes it again (with a reason); omit to keep it.",
  })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  confirmedSeverity?: IncidentSeverity;

  @ApiPropertyOptional({
    enum: ['INVESTIGATE', 'NO_INVESTIGATION'],
    description:
      'The review decision. INVESTIGATE moves the incident to Under Investigation, NO_INVESTIGATION to Awaiting Closure (needs decisionReason). Omit to save the review without deciding yet.',
  })
  @IsOptional()
  @IsIn(['INVESTIGATE', 'NO_INVESTIGATION'])
  decision?: 'INVESTIGATE' | 'NO_INVESTIGATION';

  @ApiPropertyOptional({
    description:
      'Why the review is being changed after its decision was made (required when anything changes then)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeReason?: string;

  @ApiPropertyOptional({ description: 'Why no investigation is needed (required for NO_INVESTIGATION)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionReason?: string;

  @ApiPropertyOptional({ description: 'Why the severity is changed at review (required when it changes)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  severityReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  investigationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  safeguardingConcern?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  possibleAbuseOrNeglect?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  furtherMedicalAttention?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  externalNotificationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escalationRequired?: boolean;

  @ApiPropertyOptional({ description: 'Is anyone currently at immediate or ongoing risk?' })
  @IsOptional()
  @IsBoolean()
  immediateRisk?: boolean;

  @ApiPropertyOptional({
    description: 'What immediate protective action is required or has been taken (required when immediateRisk is true)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  protectiveAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  managementNotes?: string;
}

export class UpsertIncidentInvestigationDto {
  @ApiPropertyOptional({ enum: IncidentInvestigationScope })
  @IsOptional()
  @IsEnum(IncidentInvestigationScope)
  investigationScope?: IncidentInvestigationScope;

  @ApiPropertyOptional({
    enum: IncidentExternalInvestigationType,
    description: 'Required when investigationScope is EXTERNAL; cleared when INTERNAL',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(IncidentExternalInvestigationType)
  externalType?: IncidentExternalInvestigationType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  whatHappened?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  whyHappened?: string;

  @ApiPropertyOptional({ enum: INCIDENT_CONTRIBUTING_FACTORS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INCIDENT_CONTRIBUTING_FACTORS, { each: true })
  contributingFactors?: string[];

  @ApiPropertyOptional({
    description:
      'Per ticked factor: related records ({ id, label }) and a note, e.g. { STAFFING: { items: [{ id, label }], note } }',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  contributingFactorDetails?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  rootCause?: string;

  @ApiPropertyOptional({ enum: IncidentPreventability })
  @IsOptional()
  @IsEnum(IncidentPreventability)
  preventable?: IncidentPreventability;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;

  // --- Set-up (omit = unchanged, null = clear) ---

  @ApiPropertyOptional({ enum: INVESTIGATION_LEVELS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(INVESTIGATION_LEVELS)
  investigationLevel?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Staff member (employee) leading the investigation: an active carer or manager',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  leadInvestigatorEmployeeId?: string | null;

  @ApiPropertyOptional({
    enum: INVESTIGATOR_INVOLVEMENT,
    nullable: true,
    description: 'Was the lead investigator directly involved in the incident?',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(INVESTIGATOR_INVOLVEMENT)
  investigatorInvolved?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the investigator is still appropriate (required when involved = YES)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  investigatorInvolvedReason?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Target completion date (YYYY-MM-DD)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY_KEY, { message: 'targetDate must be YYYY-MM-DD' })
  targetDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Terms of reference: what questions this investigation needs to answer',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(8000)
  termsOfReference?: string | null;

  // --- Evidence (omit = unchanged) ---

  @ApiPropertyOptional({ enum: INVESTIGATION_RECORDS_REVIEWED, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INVESTIGATION_RECORDS_REVIEWED, { each: true })
  recordsReviewed?: string[];

  @ApiPropertyOptional({
    description:
      'Per reviewed kind: linked records ({ id, label }) and a note, e.g. { CARE_PLAN: { items: [{ id, label }], note } }',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  recordsReviewedDetails?: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true, description: 'What was noticed while reviewing records' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(8000)
  evidenceNotes?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Evidence still awaited or unavailable' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  outstandingEvidence?: string | null;

  @ApiPropertyOptional({ description: 'Mark the investigation as complete' })
  @IsOptional()
  @IsBoolean()
  markComplete?: boolean;
}

export class PauseIncidentInvestigationDto {
  @ApiProperty({ description: 'Why the investigation is paused' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiProperty({ description: 'When the pause will be reviewed (YYYY-MM-DD, today or later)' })
  @Matches(DAY_KEY, { message: 'nextReviewDate must be YYYY-MM-DD' })
  nextReviewDate!: string;
}
