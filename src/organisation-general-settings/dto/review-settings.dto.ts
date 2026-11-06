import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { COMPLIANCE_REMINDER_STAGES } from '../review-settings.util';

export class RiskReviewDaysDto {
  @ApiPropertyOptional({ default: 14, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  HIGH?: number;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  MEDIUM?: number;

  @ApiPropertyOptional({ default: 90, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  LOW?: number;
}

/** Settings → Reviews & reminders. Every key is optional; parseReviewSettings fills the defaults. */
export class ReviewSettingsDto {
  @ApiPropertyOptional({ default: 8, minimum: 0, maximum: 23, description: 'Hour the reminder jobs start sending (organisation timezone).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderHour?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90, description: 'Overdue care plan / assessment reviews are reminded again every this many days.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  reminderRepeatDays?: number;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  carePlanDueSoonDays?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  carePlanListDueWithinDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  assessmentRemindersEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Per assessment overrides keyed by assessment key: { defaultIntervalDays?, elevatedRiskIntervalDays?, dueSoonLeadDays? }. Omitted keys use the built-in schedule.',
  })
  @IsOptional()
  @IsObject()
  assessmentIntervals?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  complianceRemindersEnabled?: boolean;

  @ApiPropertyOptional({ enum: COMPLIANCE_REMINDER_STAGES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COMPLIANCE_REMINDER_STAGES.length)
  @IsIn([...COMPLIANCE_REMINDER_STAGES], { each: true })
  complianceReminderStages?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  complianceNotifyEmployee?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  complianceEmailReminders?: boolean;

  @ApiPropertyOptional({ type: RiskReviewDaysDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RiskReviewDaysDto)
  riskReviewDays?: RiskReviewDaysDto;

  @ApiPropertyOptional({ default: 42, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  visitPlanFirstReviewDays?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  visitPlanSuspensionReviewDays?: number;

  @ApiPropertyOptional({ default: 14, minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  medicationDueSoonDays?: number;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  medicationReviewDueSoonDays?: number;
}
