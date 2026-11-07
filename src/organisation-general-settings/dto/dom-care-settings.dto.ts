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

/** Settings → Supervision. Every key optional; missing keys keep their defaults. */
export class SupervisionSettingsDto {
  @ApiPropertyOptional({ default: true, description: 'A session completes only once every carer has signed or commented.' })
  @IsOptional()
  @IsBoolean()
  requireCarerSignature?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Carers can record that they disagree, with a comment.' })
  @IsOptional()
  @IsBoolean()
  allowCarerDisagree?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Confidential notes section (needs supervision.read_confidential).' })
  @IsOptional()
  @IsBoolean()
  confidentialNotesEnabled?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Required questions on the session form must be answered before the supervisor signs.' })
  @IsOptional()
  @IsBoolean()
  requireFormAnswers?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Daily supervision-due reminders.' })
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiPropertyOptional({ default: 8, minimum: 0, maximum: 23, description: 'Hour reminders go out (organisation timezone).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderHour?: number;

  @ApiPropertyOptional({ default: 14, minimum: 1, maximum: 90, description: 'Days before the due date a review shows as Due soon.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  dueSoonDays?: number;

  @ApiPropertyOptional({ type: [Number], default: [14, 7, 1, 0], description: 'Remind this many days before the due date (0 = on the day).' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(365, { each: true })
  reminderDaysBefore?: number[];

  @ApiPropertyOptional({ type: [Number], default: [1, 7, 14], description: 'Remind again this many days after the due date.' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(365, { each: true })
  reminderDaysAfter?: number[];

  @ApiPropertyOptional({ default: 7, minimum: 0, maximum: 365, description: 'Overdue by this many days → branch managers are told (0 = never).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  escalateAfterDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifySupervisor?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Push a reminder to the carer\'s phone.' })
  @IsOptional()
  @IsBoolean()
  notifyCarer?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Branch managers get every reminder, not only escalations.' })
  @IsOptional()
  @IsBoolean()
  managersOnAllReminders?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Completing a session books the next one on its due date.' })
  @IsOptional()
  @IsBoolean()
  autoScheduleNext?: boolean;
}

export class ServiceUserWeeklyHoursSettingsDto {
  @ApiProperty({ description: 'Changing a service user\'s weekly hours waits for a manager.' })
  @IsBoolean()
  changeNeedsApproval!: boolean;

  @ApiProperty({ description: 'New visits over the weekly hours go to Hours approvals.' })
  @IsBoolean()
  visitsNeedApproval!: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  specialVisitsCount?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Visits over the weekly hours use the timebank when it covers them.' })
  @IsOptional()
  @IsBoolean()
  useTimebank?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Over care in a finished week is taken back the next week.' })
  @IsOptional()
  @IsBoolean()
  adjustOverCareNextWeek?: boolean;

  @ApiPropertyOptional({ default: true, description: "A finished week's timebank hours are charged on the weekly invoice." })
  @IsOptional()
  @IsBoolean()
  chargeTimebankOnInvoice?: boolean;
}
