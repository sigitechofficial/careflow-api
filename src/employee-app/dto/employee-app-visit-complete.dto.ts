import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ScheduledVisitStatus } from '../../scheduled-visits/enums/scheduled-visit-status.enum';
import { DeliveredCarePlanDetailDto } from '../../scheduled-jobs-housekeeping/dto/delivered-care-plan-detail.dto';

export class EmployeeAppLeavingSafeChecksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiredTasksComplete?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  medicationRecorded?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  personSafeComfortable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  homeSecure?: boolean;
}

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

  @ApiPropertyOptional({
    description: 'Contract visit outcome alias',
    enum: ['fully_delivered', 'partially_met', 'not_met'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  visitOutcome?: string;

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
      'Required when clock-out is early or late vs planned end. Value is the admin catalog label (or a legacy reason code).',
    example: 'Client asked to finish early',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  timingExceptionReasonCode?: string;

  @ApiPropertyOptional({
    description: 'Free-text notes for the timing exception (required when reason is OTHER)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  timingExceptionNotes?: string;

  @ApiPropertyOptional({ type: EmployeeAppLeavingSafeChecksDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmployeeAppLeavingSafeChecksDto)
  leavingSafeChecks?: EmployeeAppLeavingSafeChecksDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deviceRecordedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockLocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockedLocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withinArea?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  distanceMeters?: number;
}
