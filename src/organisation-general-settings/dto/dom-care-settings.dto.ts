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
import { WEEKLY_HOURS_OVER_MAX_OPTIONS } from '../dom-care-allocation-rules.util';
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
  @ApiPropertyOptional({
    enum: WEEKLY_HOURS_OVER_MAX_OPTIONS,
    description: "Above a carer's maximum weekly hours: NO (never, default) or YES (follows the approval setting).",
  })
  @IsOptional()
  @IsIn([...WEEKLY_HOURS_OVER_MAX_OPTIONS, 'MANAGER_APPROVAL'])
  allowOverMax?: (typeof WEEKLY_HOURS_OVER_MAX_OPTIONS)[number] | 'MANAGER_APPROVAL';

  @ApiPropertyOptional({ description: 'Called-off visits count in the carer weekly hours (default true).' })
  @IsOptional()
  @IsBoolean()
  countCalledOff?: boolean;

  @ApiPropertyOptional({ description: 'Changing contracted weekly hours needs manager approval (default true).' })
  @IsOptional()
  @IsBoolean()
  contractedChangeNeedsApproval?: boolean;

  @ApiPropertyOptional({ description: 'Adding extra weekly hours needs manager approval (default false).' })
  @IsOptional()
  @IsBoolean()
  extraHoursNeedApproval?: boolean;

  /** No longer used (30 Oct 2026); accepted so an older admin page can still save. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  rejectAction?: string;

  /** No longer used (30 Oct 2026): each carer's Employment maximum applies instead. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxApprovableHours?: number;
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

  /** No longer used (30 Oct 2026): every rejection needs a reason. Accepted so older pages can save. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsBoolean()
  extraRejectReasonRequired?: boolean;

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
