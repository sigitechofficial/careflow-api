import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class FilterCarersDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Employee role lookup ids' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Job title / designation ids' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  designationIds?: string[];

  @ApiPropertyOptional({ description: 'Regular employed (not bank/agency)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  employed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  bankStaff?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  agencyStaff?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Schedule area ids' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  zoneIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  availableOnly?: boolean;

  @ApiPropertyOptional({ example: '2026-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
