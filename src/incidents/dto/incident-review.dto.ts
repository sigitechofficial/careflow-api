import { ApiPropertyOptional } from '@nestjs/swagger';
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
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { INCIDENT_CONTRIBUTING_FACTORS } from '../incident-review.constants';

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

  @ApiPropertyOptional({ description: 'Mark the investigation as complete' })
  @IsOptional()
  @IsBoolean()
  markComplete?: boolean;
}
