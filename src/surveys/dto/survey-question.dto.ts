import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsUUID,
} from 'class-validator';
import { SurveyQuestionType } from '@prisma/client';

/**
 * Options / config are checked against the question type in the service
 * (normaliseQuestionSettings): choice questions need two or more distinct, non-empty options;
 * a rating takes whole-number { min, max }; other types take neither.
 */
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
    description: 'Answer options for SINGLE_SELECT / MULTI_SELECT (custom labels for LIKERT)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[] | null;

  @ApiPropertyOptional({
    description:
      'SINGLE_SELECT / MULTI_SELECT: take the options from a CareFlow list instead (ETHNICITY, SEXUAL_ORIENTATION, GENDER, SEX, LANGUAGE, MARITAL_STATUS); null = own options',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  optionsFrom?: string | null;

  @ApiPropertyOptional({
    description:
      'RATING: { min, max } whole numbers. SINGLE_SELECT / MULTI_SELECT / LIKERT: { notCountedOptions: answers } — answers such as "Don’t know" left out of the percentages',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Add the question straight after this one ("Add question here" in a section); sortOrder is then ignored' })
  @IsOptional()
  @IsUUID()
  afterQuestionId?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Heading of the section the question sits in (empty = no section heading)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sectionTitle?: string | null;

  @ApiPropertyOptional({
    description:
      'SINGLE_SELECT / MULTI_SELECT: an "Other" choice with a text box — { label, textPrompt, textRequired } (null = none)',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  otherOption?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description:
      'MULTI_SELECT: options that cannot be combined with any other (e.g. "None of these"); each must be one of the options',
    type: [String],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclusiveOptions?: string[] | null;

  @ApiPropertyOptional({
    description:
      'Comment box alongside the answer (not TEXT / TEXTAREA) — { prompt, showWhen: answers | null } (null = none)',

    nullable: true,
  })
  @IsOptional()
  @IsObject()
  commentConfig?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description:
      'Ask only when an earlier question (by its key) has one of these answers — { questionKey, answers } (null = always)',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  showIf?: Record<string, unknown> | null;
}

export class UpdateSurveyQuestionDto extends PartialType(OmitType(CreateSurveyQuestionDto, ['afterQuestionId'] as const)) {}

/** Move a question one place up or down (its "Show only if" rules decide whether it can). */
export class MoveSurveyQuestionDto {
  @ApiProperty({ enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}
