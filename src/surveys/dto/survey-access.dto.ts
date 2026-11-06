import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { SURVEY_ALERT_OWNER_KEYS } from '../survey-alert-rules.util';

export class AccessLevelDto {
  @ApiProperty({ description: 'Limited to the roles and people below (false = everyone with survey access)' })
  @IsBoolean()
  restricted!: boolean;

  @ApiPropertyOptional({ enum: SURVEY_ALERT_OWNER_KEYS, isArray: true, description: 'Ready-made roles, through the organisation’s setting' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(SURVEY_ALERT_OWNER_KEYS, { each: true })
  ownerKeys?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds?: string[];
}

export class UpdateSurveyAccessDto {
  @ApiProperty({ type: AccessLevelDto, description: 'Individual responses and written answers' })
  @ValidateNested()
  @Type(() => AccessLevelDto)
  responses!: AccessLevelDto;

  @ApiProperty({ type: AccessLevelDto, description: 'The figures (results, breakdowns, CSV, CQC evidence)' })
  @ValidateNested()
  @Type(() => AccessLevelDto)
  results!: AccessLevelDto;

  @ApiPropertyOptional({ nullable: true, description: 'Fewest responses before figures show; null = the default' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  reportingThreshold?: number | null;

  @ApiPropertyOptional({ description: 'Check only: return the alert rules this access would leave without a role that can see the results' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Go back to the ready-made survey’s default access' })
  @IsOptional()
  @IsBoolean()
  useReadyMadeDefault?: boolean;
}

export class SurveyAccessPeopleQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateShareLinkDto {
  @ApiProperty({ description: 'The branch the link is for' })
  @IsUUID()
  locationId!: string;
}

export class SetSharedLinkDto {
  @ApiProperty({ description: 'Staff and service-user surveys: answers also through one shared link' })
  @IsBoolean()
  enabled!: boolean;
}

export class CopyRecipientLinksDto {
  @ApiProperty({ enum: ['ONE', 'ALL', 'CSV'], description: 'One person, everyone (copy), or a mail-merge download' })
  @IsIn(['ONE', 'ALL', 'CSV'])
  purpose!: 'ONE' | 'ALL' | 'CSV';

  @ApiPropertyOptional({ type: [String], description: 'Only these people (recipient ids); everyone when left out' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  recipientIds?: string[];

  @ApiPropertyOptional({ description: 'Only people who have not answered yet' })
  @IsOptional()
  @IsBoolean()
  onlyNotAnswered?: boolean;
}

export class SharedLinkSettingsDto {
  @ApiProperty({ description: 'One answer per device (a marker kept only on the device, never with the answer)' })
  @IsBoolean()
  oncePerDevice!: boolean;
}

export class SharedLinkLimitDto {
  @ApiProperty({ nullable: true, description: 'Answers per 10 minutes through each shared link for a planned sitting; null = the standard limit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Until when (ISO date-time), at most 7 days ahead' })
  @IsOptional()
  @IsISO8601()
  until?: string | null;
}

export class RecordSurveyExportDto {
  @ApiProperty({ enum: ['RESULTS_CSV'] })
  @IsIn(['RESULTS_CSV'])
  kind!: 'RESULTS_CSV';

  @ApiPropertyOptional({ description: 'The period the file covers, in words' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  period?: string;

  @ApiPropertyOptional({ description: 'Several groups: the group the file is for' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  respondentGroup?: string;
}

export class SurveySectionChangeDto {
  @ApiProperty({ description: 'The section (its current title)' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Rename: the new title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rename?: string;

  @ApiPropertyOptional({ nullable: true, description: 'One or two sentences shown under the heading (null or empty = none)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  introduction?: string | null;

  @ApiPropertyOptional({ enum: ['up', 'down'] })
  @IsOptional()
  @IsIn(['up', 'down'])
  move?: 'up' | 'down';
}

export class SurveySectionPlaceDto {
  @ApiProperty({ description: 'The question to move' })
  @IsUUID()
  questionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'The section to move it into (null or empty = no section)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;
}
