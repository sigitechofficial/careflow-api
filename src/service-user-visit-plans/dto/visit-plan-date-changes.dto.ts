import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VisitCancellationReasonCode, VisitChargeDecision, VisitPlanNightDuty } from '@prisma/client';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class VisitPlanDateChangesRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-13', description: 'Defaults to today' })
  @IsOptional()
  @Matches(DATE_ONLY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-09', description: 'Defaults to the rota horizon' })
  @IsOptional()
  @Matches(DATE_ONLY)
  to?: string;
}

export class VisitPlanDateChangeItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  visitPlanSlotId!: string;

  @ApiProperty({ example: '2026-10-20' })
  @Matches(DATE_ONLY)
  date!: string;
}

export class VisitPlanCancelVisitsPreviewDto {
  @ApiProperty({ type: [VisitPlanDateChangeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VisitPlanDateChangeItemDto)
  items!: VisitPlanDateChangeItemDto[];

  @ApiProperty({ enum: ['SERVICE_USER', 'AGENCY', 'OTHER'] })
  @IsIn(['SERVICE_USER', 'AGENCY', 'OTHER'])
  cancelledBy!: 'SERVICE_USER' | 'AGENCY' | 'OTHER';

  @ApiProperty({ enum: VisitCancellationReasonCode })
  @IsEnum(VisitCancellationReasonCode)
  reasonCode!: VisitCancellationReasonCode;
}

export class VisitPlanCancelVisitsDto extends VisitPlanCancelVisitsPreviewDto {
  @ApiPropertyOptional({ description: 'Required when cancelledBy is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cancelledByDescription?: string;

  @ApiPropertyOptional({ description: 'Required when the reason is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reasonNotes?: string;

  @ApiPropertyOptional({
    enum: VisitChargeDecision,
    description: 'Only sent when staff override the policy suggestion; applies to every selected visit',
  })
  @IsOptional()
  @IsEnum(VisitChargeDecision)
  chargeDecision?: VisitChargeDecision;

  @ApiPropertyOptional({ description: 'Required when chargeDecision overrides the policy' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  chargeDecisionNotes?: string;

  @ApiProperty()
  @IsBoolean()
  welfareChecked!: boolean;

  @ApiProperty()
  @IsBoolean()
  familyNotified!: boolean;

  @ApiProperty()
  @IsBoolean()
  commissionerNotified!: boolean;
}

export class VisitPlanExtraVisitsPreviewDto {
  @ApiPropertyOptional({
    example: 'MORNING',
    description: 'Time slot to add the visit to; the start time must fall in its window. Found from the start time when left out.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  roundCode?: string;

  @ApiProperty({ type: [String], example: ['2026-10-24', '2026-10-25'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(62)
  @Matches(DATE_ONLY, { each: true })
  dates!: string[];

  @ApiProperty({ example: '15:30' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @ApiProperty({ minimum: 1, maximum: 720 })
  @IsInt()
  @Min(1)
  @Max(720)
  durationMinutes!: number;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  requiredCarers!: number;

  @ApiProperty({ type: [String], description: 'Carers chosen for the extra visit (may be empty)' })
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID(undefined, { each: true })
  employeeIds!: string[];
}

export class VisitPlanAddExtraVisitsDto extends VisitPlanExtraVisitsPreviewDto {
  @ApiProperty({ description: 'Why the extra visit is needed' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    enum: VisitPlanNightDuty,
    description: 'Only for a visit that runs past midnight; NONE (normal visit) when left out',
  })
  @IsOptional()
  @IsEnum(VisitPlanNightDuty)
  nightDuty?: VisitPlanNightDuty;
}
