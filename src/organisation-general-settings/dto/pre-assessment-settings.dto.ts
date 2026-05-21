import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PreAssessmentChecklistItemDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional()
  @IsBoolean()
  selected!: boolean;
}
