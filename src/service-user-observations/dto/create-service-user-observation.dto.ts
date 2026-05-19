import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { WellbeingScoreDto } from './wellbeing-score.dto';

export class CreateServiceUserObservationDto {
  @ApiProperty({ example: 'WEIGHT', description: 'Observation type code from lookups.' })
  @IsString()
  observationTypeCode!: string;

  @ApiProperty({ example: '2026-05-19T15:29:00.000Z' })
  @IsISO8601()
  recordedAt!: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Primary numeric value (weight, RPM, temperature, etc.).' })
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional({ description: 'Unit override; defaults to type unit when omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @ApiPropertyOptional({
    description: 'Structured fields for composite types (blood pressure, fluid, falls, etc.).',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], example: ['HANDOVER', 'MANAGER'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareTargetCodes?: string[];

  @ApiPropertyOptional({ type: [WellbeingScoreDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WellbeingScoreDto)
  wellbeingScores?: WellbeingScoreDto[];
}
