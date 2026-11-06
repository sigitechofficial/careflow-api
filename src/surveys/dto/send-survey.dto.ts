import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SurveyRecurrence } from '@prisma/client';

export class ContactRuleOverrideDto {
  @ApiProperty({ description: 'Why (5–300 characters)' })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}

/**
 * Send now, schedule, or start a repeating series. The audience chosen here (branches, job
 * titles, chosen employees or chosen people we support) is saved on the survey, so scheduled and repeating sends use it.
 * Omit a field to keep the survey's saved value; an empty list means "everyone".
 */
export class SendSurveyDto {
  @ApiPropertyOptional({
    description: 'Chosen employees (instead of branches / job titles). Empty = everyone in the audience.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({
    description:
      'Chosen people we support (service-user surveys, instead of branches). Empty = everyone in the branches. On named surveys people without a portal account are added too, for answers recorded by phone, visit or post.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional({
    description: 'Branch (location) ids. Empty = all branches you can reach.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({
    description: 'Job title ids (employee surveys). Empty = all job titles.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({
    description:
      'A future time schedules the send. With recurrence it is the first period (omit to start now).',
  })
  @IsOptional()
  @IsISO8601()
  distributeAt?: string;

  @ApiPropertyOptional({
    enum: SurveyRecurrence,
    nullable: true,
    description: 'Repeat: each period a new copy is created and sent. null = one-off.',
  })
  @IsOptional()
  @IsEnum(SurveyRecurrence)
  recurrence?: SurveyRecurrence | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Repeating surveys: keep each period open this many days (null = until the next period starts).',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(366)
  periodOpenDays?: number | null;

  @ApiPropertyOptional({
    type: () => ContactRuleOverrideDto,
    description:
      'Send now only: also send to people surveyed in the last 4 weeks (the 4-week rule), with the reason. Audited.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactRuleOverrideDto)
  contactRuleOverride?: ContactRuleOverrideDto;

  @ApiPropertyOptional({
    description:
      'A repeat shorter than 4 weeks (WEEKLY): why people should be asked this often (5–300 characters). Required ' +
      'unless the ready-made survey gives one (timing.repeatReason). Audited.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  repeatReason?: string;

  @ApiPropertyOptional({
    description:
      'Send now to people who left or whose care ended in the last 3 months (chosen by name): why (5–300 characters). Not needed on leavers’ or care-ended surveys. Audited.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  formerReason?: string;
}
