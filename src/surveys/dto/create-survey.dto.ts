import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SurveyTargetKind } from '@prisma/client';

/**
 * A new survey (or template) starts as a draft with no questions. Sending and scheduling
 * happen from the survey builder once it has questions (POST /surveys/:id/send).
 */
export class CreateSurveyDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000, description: 'Shown to people after they submit (the closing screen)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  closingMessage?: string | null;

  @ApiPropertyOptional({ enum: SurveyTargetKind, default: SurveyTargetKind.EMPLOYEE })
  @IsOptional()
  @IsEnum(SurveyTargetKind)
  targetKind?: SurveyTargetKind;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Who it's for, on top of the audience type (e.g. FAMILIES, CARE_WORKERS, NEW_CLIENTS, OTHER, SEVERAL — see prisma/seed-lib/survey-audience-groups.ts)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  audienceGroup?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'audienceGroup OTHER: the group in your own words' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  audienceGroupOther?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Named surveys: each person may choose to answer without their name (stored like an anonymous answer). Ignored on anonymous surveys.',
  })
  @IsOptional()
  @IsBoolean()
  allowAnonymousResponses?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Create a reusable template: a starting point that is never sent or answered.',
  })
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @ApiPropertyOptional({ description: 'ISO date-time the survey opens' })
  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  @ApiPropertyOptional({ description: 'ISO date-time the survey closes' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;

  @ApiPropertyOptional({ description: 'Location (branch) IDs the survey is for', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({
    description: 'Job title IDs to limit an employee survey to. Omit or empty = all job titles.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}
