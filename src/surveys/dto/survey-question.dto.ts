import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SurveyQuestionType } from '@prisma/client';

export class CreateSurveyQuestionDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  questionText!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  helpText?: string;

  @ApiProperty({ enum: SurveyQuestionType })
  @IsEnum(SurveyQuestionType)
  questionType!: SurveyQuestionType;

  @ApiPropertyOptional({
    description: 'Choice options for SINGLE_SELECT / MULTI_SELECT',
    type: [String],
  })
  @IsOptional()
  options?: unknown;

  @ApiPropertyOptional({
    description: 'Type-specific config, e.g. { min, max } for RATING',
  })
  @IsOptional()
  config?: unknown;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSurveyQuestionDto extends PartialType(CreateSurveyQuestionDto) {}
