import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
}
