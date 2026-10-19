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
import { SurveyRecurrence, SurveyTargetKind } from '@prisma/client';

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

  @ApiPropertyOptional({ enum: SurveyTargetKind, default: SurveyTargetKind.EMPLOYEE })
  @IsOptional()
  @IsEnum(SurveyTargetKind)
  targetKind?: SurveyTargetKind;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Mark this survey as a reusable template.' })
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

  @ApiPropertyOptional({ description: 'ISO date-time to auto-send the survey to employees' })
  @IsOptional()
  @IsISO8601()
  distributeAt?: string;

  @ApiPropertyOptional({
    enum: SurveyRecurrence,
    description:
      'When set with distributeAt, each due run clones this survey and sends the clone (weekly/monthly/quarterly/yearly).',
  })
  @IsOptional()
  @IsEnum(SurveyRecurrence)
  recurrence?: SurveyRecurrence;

  @ApiPropertyOptional({ description: 'Location (branch) IDs to scope the survey to', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({
    description:
      'Employee job-role (EmployeeRoleLookup) IDs to scope an employee survey to. Omit or empty = all roles.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}
