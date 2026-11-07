import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { SURVEY_CALL_OUTCOMES, SURVEY_OPT_OUT_CHANNELS, SURVEY_OPT_OUT_SUBJECTS } from '../survey-reminders.service';

/** The contact plan is checked in full by checkContactPlan (survey-contact-plan.util.ts). */
export class SaveSurveyContactPlanDto {
  @ApiPropertyOptional({ description: 'The plan, or null to turn reminders off', nullable: true, type: Object })
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  plan!: Record<string, unknown> | null;
}

export class RecordSurveyCallDto {
  @ApiProperty({ enum: SURVEY_CALL_OUTCOMES })
  @IsIn(SURVEY_CALL_OUTCOMES as unknown as string[])
  outcome!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class SurveyOptOutQueryDto {
  @ApiProperty({ enum: SURVEY_OPT_OUT_SUBJECTS })
  @IsIn(SURVEY_OPT_OUT_SUBJECTS as unknown as string[])
  subjectKind!: string;

  @ApiProperty()
  @IsUUID()
  subjectId!: string;
}

export class SetSurveyOptOutsDto extends SurveyOptOutQueryDto {
  @ApiProperty({ isArray: true, enum: SURVEY_OPT_OUT_CHANNELS, description: 'Empty = they may be contacted' })
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(SURVEY_OPT_OUT_CHANNELS as unknown as string[], { each: true })
  channels!: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

/** Surveys still to collect: everyone, or one person (their record's "Surveys due"). */
export class SurveysToCollectQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
