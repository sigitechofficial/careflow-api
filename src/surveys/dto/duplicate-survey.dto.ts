import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SurveyTargetKind } from '@prisma/client';

/** Optional overrides applied to a duplicated survey. Anything omitted is copied from the source. */
export class DuplicateSurveyDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: SurveyTargetKind })
  @IsOptional()
  @IsEnum(SurveyTargetKind)
  targetKind?: SurveyTargetKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({
    description:
      'Named surveys: let people choose to answer without their name. Ignored (off) when the new survey is anonymous; cannot be turned off when the ready-made survey promises it.',
  })
  @IsOptional()
  @IsBoolean()
  allowAnonymousResponses?: boolean;

  @ApiPropertyOptional({
    description: 'Branch (location) ids for the new survey. Empty = all branches you can reach.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({
    description: 'Job title IDs. Only applied when targetKind is EMPLOYEE.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ description: 'ISO date-time the new survey opens (never copied from the source)' })
  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  @ApiPropertyOptional({ description: 'ISO date-time the new survey closes (never copied from the source)' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;

  @ApiPropertyOptional({ nullable: true, description: "Who it's for (audience group code)" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  audienceGroup?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  audienceGroupOther?: string | null;
}
