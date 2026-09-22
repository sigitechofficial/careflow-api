import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SurveyTargetKind } from '@prisma/client';

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

  @ApiPropertyOptional({ description: 'ISO date-time the survey opens' })
  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  @ApiPropertyOptional({ description: 'ISO date-time the survey closes' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;
}
