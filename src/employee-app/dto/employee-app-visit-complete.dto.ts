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
import { DeliveredCarePlanDetailDto } from '../../scheduled-jobs-housekeeping/dto/delivered-care-plan-detail.dto';

export class EmployeeAppVisitCompleteDto {
  @ApiPropertyOptional({
    enum: [
      ScheduledVisitStatus.COMPLETED,
      ScheduledVisitStatus.PARTIALLY_COMPLETED,
      ScheduledVisitStatus.MISSED,
      ScheduledVisitStatus.NEEDS_ATTENTION,
    ],
    description:
      'Visit outcome (defaults to COMPLETED). Cancel/call-off are not allowed on the carer app.',
    example: ScheduledVisitStatus.COMPLETED,
  })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  handoverNote?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deliveredCarePlanFormIds?: string[];

  @ApiPropertyOptional({ type: [DeliveredCarePlanDetailDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveredCarePlanDetailDto)
  deliveredCarePlanDetails?: DeliveredCarePlanDetailDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  extraCareNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  actualStartDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  overrunReason?: string;

  @ApiPropertyOptional({
    description:
      'Required when actual times are early/late/short/overrun vs planned (e.g. CLIENT_REQUEST_OR_NEED, CLINICAL_COMPLEXITY). Use OTHER with timingExceptionNotes.',
    example: 'CLIENT_REQUEST_OR_NEED',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timingExceptionReasonCode?: string;

  @ApiPropertyOptional({
    description: 'Free-text notes for the timing exception (required when reason is OTHER)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  timingExceptionNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  accuracyMeters?: number;
}
