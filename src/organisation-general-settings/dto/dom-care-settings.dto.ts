import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WEEKLY_HOURS_LIMIT_BASES,
  WEEKLY_HOURS_REJECT_ACTIONS,
} from '../dom-care-allocation-rules.util';
import {
  SU_BULK_OVER_LIMIT,
  SU_DRAFT_OVER_LIMIT,
  SU_EXTRA_EDIT_OVER_LIMIT,
  SU_EXTRA_OVER_LIMIT,
  SU_HOURS_CHANGE_APPROVAL,
  SU_HOURS_CHECK_WEEKS_MAX,
  SU_HOURS_CHECK_WEEKS_MIN,
  SU_HOURS_DECREASE_ACTIONS,
  SU_PLAN_OVER_LIMIT,
  SU_SPECIAL_OVER_LIMIT,
} from '../service-user-weekly-hours-settings.util';

export class DomJobCancellationRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  hoursFrom!: number;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  hoursTo!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  chargeServiceUserPercent!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  payEmployeePercent!: number;
}

const ALLOCATION_BEHAVIORS = [
  'DONT_ALLOW',
  'ALWAYS_ALLOW',
  'REQUEST_CONFIRMATION',
  'MANAGER_APPROVAL',
] as const;

export class DomWeeklyHoursRuleOptionsDto {
  @ApiProperty({ enum: WEEKLY_HOURS_LIMIT_BASES })
  @IsIn(WEEKLY_HOURS_LIMIT_BASES)
  limitBasis!: (typeof WEEKLY_HOURS_LIMIT_BASES)[number];

  @ApiProperty({ enum: WEEKLY_HOURS_REJECT_ACTIONS })
  @IsIn(WEEKLY_HOURS_REJECT_ACTIONS)
  rejectAction!: (typeof WEEKLY_HOURS_REJECT_ACTIONS)[number];

  @ApiProperty({ minimum: 1, maximum: 168 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  maxApprovableHours!: number;
}

export class DomCareAllocationRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: ALLOCATION_BEHAVIORS })
  @IsIn(ALLOCATION_BEHAVIORS)
  behavior!: (typeof ALLOCATION_BEHAVIORS)[number];

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  minutes?: number | null;

  @ApiPropertyOptional({ type: DomWeeklyHoursRuleOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DomWeeklyHoursRuleOptionsDto)
  weeklyHours?: DomWeeklyHoursRuleOptionsDto;
}

export class DomCareShiftDefinitionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '06:00' })
  @IsString()
  @MaxLength(5)
  fromTime!: string;

  @ApiProperty({ example: '10:59' })
  @IsString()
  @MaxLength(5)
  toTime!: string;

  @ApiProperty({ example: '#F4D03F' })
  @IsString()
  @MaxLength(7)
  colorHex!: string;

  @ApiProperty()
  @IsBoolean()
  endsNextDay!: boolean;

  @ApiProperty({ minimum: 0, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder!: number;
}

export class DomLateVisitZoneAlertDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  zoneKey!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  emailEmployeeIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationEmployeeIds!: string[];
}

export class ServiceUserWeeklyHoursSettingsDto {
  @ApiProperty({ enum: SU_HOURS_CHANGE_APPROVAL })
  @IsIn(SU_HOURS_CHANGE_APPROVAL)
  changeApproval!: (typeof SU_HOURS_CHANGE_APPROVAL)[number];

  @ApiProperty({ enum: SU_HOURS_DECREASE_ACTIONS })
  @IsIn(SU_HOURS_DECREASE_ACTIONS)
  decreaseAction!: (typeof SU_HOURS_DECREASE_ACTIONS)[number];

  @ApiProperty({ enum: SU_PLAN_OVER_LIMIT })
  @IsIn(SU_PLAN_OVER_LIMIT)
  planOverLimit!: (typeof SU_PLAN_OVER_LIMIT)[number];

  @ApiProperty({ enum: SU_EXTRA_OVER_LIMIT })
  @IsIn(SU_EXTRA_OVER_LIMIT)
  extraOverLimit!: (typeof SU_EXTRA_OVER_LIMIT)[number];

  @ApiProperty()
  @IsBoolean()
  extraApproveRecheck!: boolean;

  @ApiProperty()
  @IsBoolean()
  extraRejectReasonRequired!: boolean;

  @ApiProperty({ enum: SU_EXTRA_EDIT_OVER_LIMIT })
  @IsIn(SU_EXTRA_EDIT_OVER_LIMIT)
  extraEditOverLimit!: (typeof SU_EXTRA_EDIT_OVER_LIMIT)[number];

  @ApiPropertyOptional({ enum: SU_BULK_OVER_LIMIT, default: 'WARN' })
  @IsOptional()
  @IsIn(SU_BULK_OVER_LIMIT)
  bulkOverLimit?: (typeof SU_BULK_OVER_LIMIT)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  specialVisitsCount?: boolean;

  @ApiPropertyOptional({ enum: SU_SPECIAL_OVER_LIMIT, default: 'WARN' })
  @IsOptional()
  @IsIn(SU_SPECIAL_OVER_LIMIT)
  specialVisitOverLimit?: (typeof SU_SPECIAL_OVER_LIMIT)[number];

  @ApiPropertyOptional({ enum: SU_DRAFT_OVER_LIMIT, default: 'BLOCK' })
  @IsOptional()
  @IsIn(SU_DRAFT_OVER_LIMIT)
  draftOverLimit?: (typeof SU_DRAFT_OVER_LIMIT)[number];

  @ApiProperty({ minimum: SU_HOURS_CHECK_WEEKS_MIN, maximum: SU_HOURS_CHECK_WEEKS_MAX })
  @Type(() => Number)
  @IsInt()
  @Min(SU_HOURS_CHECK_WEEKS_MIN)
  @Max(SU_HOURS_CHECK_WEEKS_MAX)
  checkWeeks!: number;
}
