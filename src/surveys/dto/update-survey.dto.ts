import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SurveyTargetKind } from '@prisma/client';

/**
 * Edit a survey's details. Status changes go through their own actions (open, publish, close,
 * send) and schedules through send / cancel-schedule, so an update cannot bypass their checks.
 */
export class UpdateSurveyDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000, description: 'Shown to people after they submit (the closing screen); empty = none' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  closingMessage?: string | null;

  @ApiPropertyOptional({ enum: SurveyTargetKind, description: 'Locked once sent or answered.' })
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

  @ApiPropertyOptional({ description: 'Locked once sent or answered.' })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({
    description:
      'Named surveys: "Let people choose to answer without their name". Cannot be turned off once sent or answered, nor when the ready-made survey promises it. Always false on anonymous surveys.',
  })
  @IsOptional()
  @IsBoolean()
  allowAnonymousResponses?: boolean;

  @ApiPropertyOptional({
    description:
      'true only for surveys never sent or answered (otherwise use save-as-template); false moves a template back to Surveys.',
  })
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  opensAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  closesAt?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Locked once sent or answered.' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Recurring surveys: keep each period open this many days (null = until the next period starts).',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(366)
  periodOpenDays?: number | null;
}
