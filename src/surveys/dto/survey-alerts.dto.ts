import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ALERT_DUE_WORKING_DAYS,
  MAX_ALERT_DUE_CALENDAR_DAYS,
  MAX_ALERT_TASK_LENGTH,
  SURVEY_ALERT_OUTCOMES,
  SURVEY_ALERT_OWNER_KEYS,
  SURVEY_ALERT_RECORDS,
} from '../survey-alert-rules.util';

export class SurveyAlertConditionDto {
  @ApiProperty({ description: "The question's key" })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  questionKey!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  answers!: string[];

  @ApiPropertyOptional({ description: 'Answered, but none of these chosen (a checklist gap)' })
  @IsOptional()
  @IsBoolean()
  not?: boolean;
}

export class SaveSurveyAlertRuleDto {
  @ApiProperty({ description: 'Task title' })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_ALERT_TASK_LENGTH)
  title!: string;

  @ApiPropertyOptional({ description: 'When it fires, in words (filled in from the conditions when left empty)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  whenText?: string;

  @ApiProperty({ description: 'What to do (the task instructions)' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  actionText!: string;

  @ApiProperty({ type: [SurveyAlertConditionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SurveyAlertConditionDto)
  conditions!: SurveyAlertConditionDto[];

  @ApiPropertyOptional({ enum: SURVEY_ALERT_OWNER_KEYS, nullable: true })
  @IsOptional()
  @IsIn([...SURVEY_ALERT_OWNER_KEYS, null])
  ownerKey?: string | null;

  @ApiPropertyOptional({ description: 'Role for this rule (overrides the owner setting)', nullable: true })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;

  @ApiPropertyOptional({ enum: ['any', 'all'], description: 'any = one of the conditions; all = every one' })
  @IsOptional()
  @IsIn(['any', 'all'])
  match?: 'any' | 'all';

  @ApiPropertyOptional({ description: 'Keep the stored conditions (a ready-made combination this screen cannot show)' })
  @IsOptional()
  @IsBoolean()
  keepConditions?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Answers given without a name: raise only if at least this many answered' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  minimumAnswers?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ALERT_DUE_WORKING_DAYS, description: 'Working days (0 = the same working day). Give this or dueCalendarDays, not both.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ALERT_DUE_WORKING_DAYS)
  dueWorkingDays?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: MAX_ALERT_DUE_CALENDAR_DAYS, description: 'Calendar days instead ("within 7 days"); wins over dueWorkingDays' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ALERT_DUE_CALENDAR_DAYS)
  dueCalendarDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @ApiPropertyOptional({ enum: SURVEY_ALERT_RECORDS, nullable: true })
  @IsOptional()
  @IsIn([...SURVEY_ALERT_RECORDS, null])
  recordKind?: string | null;

  @ApiPropertyOptional({ description: 'Contact-me follow-up (contact-me question answered Yes only)' })
  @IsOptional()
  @IsBoolean()
  contactRequest?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetAlertOwnerRoleDto {
  @ApiPropertyOptional({ nullable: true, description: 'null = use the usual role name' })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;
}

export class ListSurveyFollowUpsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'overdue', 'contact', 'done', 'all'] })
  @IsOptional()
  @IsIn(['open', 'overdue', 'contact', 'done', 'all'])
  view?: 'open' | 'overdue' | 'contact' | 'done' | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  surveyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  alertId?: string;
}

export class UpdateSurveyFollowUpDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'DONE'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'DONE'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'DONE';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Give an alert with no role to this role' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ enum: SURVEY_ALERT_OUTCOMES, nullable: true })
  @IsOptional()
  @IsIn([...SURVEY_ALERT_OUTCOMES, null])
  outcomeKind?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outcome?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Reference of the complaint, compliment, safeguarding case or incident started from it; empty to unlink' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  linkedReference?: string | null;
}

export class NeverRouteToDto {
  @ApiProperty({ enum: SURVEY_ALERT_OWNER_KEYS, isArray: true })
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(SURVEY_ALERT_OWNER_KEYS, { each: true })
  ownerKeys!: string[];
}

/** The built-in safeguarding-words alert: on, or off with the reason. */
export class SafeguardingWordsDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}
