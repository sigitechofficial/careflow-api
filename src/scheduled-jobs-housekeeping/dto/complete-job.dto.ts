import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ScheduledVisitStatus } from '../../scheduled-visits/enums/scheduled-visit-status.enum';
import { DeliveredCarePlanDetailDto } from './delivered-care-plan-detail.dto';

export class CompleteJobCarerActualDto {
  @ApiPropertyOptional({ description: 'Job allocation id for this carer' })
  @IsUUID()
  allocationId!: string;

  @ApiPropertyOptional({ description: 'Carer actual start (ISO 8601)' })
  @IsISO8601()
  actualStartDateTime!: string;

  @ApiPropertyOptional({
    description:
      'Carer actual end (ISO 8601). Required when completing; omit when status is STARTED.',
  })
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;
}

export class CompleteJobDto {
  @ApiPropertyOptional({
    enum: ScheduledVisitStatus,
    description: 'Visit outcome status (defaults to COMPLETED)',
  })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  @ApiPropertyOptional({ description: 'Completion notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Care pathway form IDs delivered during this visit' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deliveredCarePlanFormIds?: string[];

  @ApiPropertyOptional({
    type: [DeliveredCarePlanDetailDto],
    description: 'Per-care-plan task delivery outcomes',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveredCarePlanDetailDto)
  deliveredCarePlanDetails?: DeliveredCarePlanDetailDto[];

  @ApiPropertyOptional({ description: 'Visit-level extra care not covered by any care plan' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  extraCareNotes?: string;

  @ApiPropertyOptional({ description: 'Actual visit start time (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  actualStartDateTime?: string;

  @ApiPropertyOptional({
    description:
      'Actual visit end time (ISO 8601); defaults to now when completing without an end time',
  })
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;

  @ApiPropertyOptional({
    type: [CompleteJobCarerActualDto],
    description:
      'Optional per-carer actual times for multi-carer visits. Visit-level actuals become the envelope (earliest start / latest end).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteJobCarerActualDto)
  carerActuals?: CompleteJobCarerActualDto[];

  @ApiPropertyOptional({
    description: 'Required when actual duration exceeds planned duration — why the visit ran longer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  overrunReason?: string;

  @ApiPropertyOptional({
    description:
      'Structured reason code required for late/early/short/overrun timing exceptions (see VISIT_TIMING_EXCEPTION_REASON_CODES)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timingExceptionReasonCode?: string;

  @ApiPropertyOptional({
    description: 'Notes for the timing/delivery exception (required when reason is OTHER)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  timingExceptionNotes?: string;

  @ApiPropertyOptional({
    description:
      'Structured reason code required when status is MISSED (see VISIT_MISSED_REASON_CODES)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  missedReasonCode?: string;

  @ApiPropertyOptional({
    description: 'Notes for the missed visit (required when missedReasonCode is OTHER)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  missedReasonNotes?: string;
}
