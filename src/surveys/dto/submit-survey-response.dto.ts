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
}

export class SubmitSurveyResponseDto {
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
}
