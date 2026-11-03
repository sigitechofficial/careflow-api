import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveCarePlanDraftDto {
  @ApiProperty({ description: 'Form Builder field values keyed by field id.' })
  @IsObject()
  values!: Record<string, string | boolean>;

  @ApiPropertyOptional({ description: 'Optional compose metadata (Phase 1+).' })
  @IsOptional()
  @IsObject()
  composedFrom?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Optional gap list (Phase 1+).' })
  @IsOptional()
  gaps?: unknown[];
}

export class PublishCarePlanDto {
  @ApiPropertyOptional({ description: 'Optional short label for version history.' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: 'Signature field payloads keyed by role.' })
  @IsOptional()
  @IsObject()
  signatures?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Required when draft has blocking compose gaps.' })
  @IsOptional()
  @IsBoolean()
  gapAcknowledged?: boolean;

  @ApiPropertyOptional({
    description:
      'Incident "Care plan update" measure this publish is for (opened from the incident). The new version is linked to it.',
  })
  @IsOptional()
  @IsUUID()
  incidentActionId?: string;
}

export class ApproveCarePlanDto {
  @ApiProperty({
    description:
      'Content hash of the draft the manager reviewed (draft.approval.contentHash).',
  })
  @IsString()
  @Length(64, 64)
  contentHash!: string;
}

export class RequestCarePlanChangesDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 2000,
    description: 'What needs to change.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class CarePlanLifecycleReasonDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 2000,
    description: 'Why the care plan is being suspended, resumed or archived.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class ResumeCarePlanDto extends CarePlanLifecycleReasonDto {
  @ApiProperty({
    description:
      'The manager confirms the published plan is still appropriate before carers see it again.',
  })
  @IsBoolean()
  reviewConfirmed!: boolean;
}

export class LinkCarePlanVisitTaskDto {
  @ApiProperty({ description: 'Existing visit task assignment of this service user.' })
  @IsUUID()
  visitTaskAssignmentId!: string;

  @ApiPropertyOptional({
    description: 'Structured care plan requirement (field key). Omit to link to the plan as a whole.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  requirementKey?: string;
}

export class UnlinkCarePlanVisitTaskDto {
  @ApiPropertyOptional({ maxLength: 2000, description: 'Why the link was wrong.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class CarePlanRequirementNotApplicableDto {
  @ApiProperty({ description: 'Structured care plan requirement (field key).' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  requirementKey!: string;

  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class LinkCarePlanRiskDto {
  @ApiProperty({ description: 'Initial assessment risk record of this service user.' })
  @IsUUID()
  riskRecordId!: string;
}

export class ResolveReassessmentFlagDto {
  @ApiProperty({ minLength: 3, maxLength: 2000, description: 'What was reviewed and decided.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;
}
