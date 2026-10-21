import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { SurveyRecurrence } from '@prisma/client';

export class SendSurveyDto {
  @ApiPropertyOptional({
    description:
      'Employee ids to send to. Omit to target all active employees (employees-first MVP).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({
    description:
      'Branch (location) ids to limit recipients to. Omit to use the survey branches (or everyone).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({
    description:
      'Employee job-role (EmployeeRoleLookup) ids to limit recipients to. Omit to use the survey roles (or all roles).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({
    description:
      'If set in the future, queue employee distribution instead of sending immediately.',
  })
  @IsOptional()
  @IsISO8601()
  distributeAt?: string;

  @ApiPropertyOptional({
    enum: SurveyRecurrence,
    description:
      'With a future distributeAt, repeat by cloning a new survey each period.',
  })
  @IsOptional()
  @IsEnum(SurveyRecurrence)
  recurrence?: SurveyRecurrence;
}
