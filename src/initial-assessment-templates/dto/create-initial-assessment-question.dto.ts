import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { InitialAssessmentQuestionType } from '../../initial-assessments/enums/initial-assessment-question-type.enum';

export class CreateInitialAssessmentQuestionDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  questionText!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  helpText?: string;

  @ApiProperty({ enum: InitialAssessmentQuestionType })
  @IsEnum(InitialAssessmentQuestionType)
  questionType!: InitialAssessmentQuestionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowNotes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  riskFlag?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  carePlanTrigger?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
