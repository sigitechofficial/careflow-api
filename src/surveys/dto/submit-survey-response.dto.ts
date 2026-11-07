import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SurveyRespondentRelation } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SurveyAnswerItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  textValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numberValue?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptions?: string[];

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'The respondent\'s own text when they chose the question\'s "Other" option.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  otherText?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: "The respondent's comment alongside their answer (questions with a comment box).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class SubmitSurveyResponseDto {
  @ApiPropertyOptional({
    description: 'How many seconds the answer page was open. Used only to flag very fast answers; never stored.',
  })
  @IsOptional()
  @IsNumber()
  secondsTaken?: number;

  @ApiProperty({ type: [SurveyAnswerItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerItemDto)
  answers!: SurveyAnswerItemDto[];

  @ApiPropertyOptional({
    enum: SurveyRespondentRelation,
    description:
      'Service-user surveys: who is answering (required for service-user links).',
  })
  @IsOptional()
  @IsEnum(SurveyRespondentRelation)
  respondentRelation?: SurveyRespondentRelation;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Name of the family member / representative.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  respondentName?: string;

  @ApiPropertyOptional({
    description:
      'Named surveys that allow it (allowAnonymousResponses): answer without my name. The response is not linked to the person, keeps the date only, and the contact-me question is not asked.',
  })
  @IsOptional()
  @IsBoolean()
  answerWithoutName?: boolean;

  @ApiPropertyOptional({ description: 'Shared links: the form token given with the form (spam protection). Never stored.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  formToken?: string;

  @ApiPropertyOptional({ description: 'Shared links: a hidden field people never see; filled only by automated senders. Never stored.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  website?: string;
}
