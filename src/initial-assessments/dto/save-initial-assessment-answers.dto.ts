import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class InitialAssessmentAnswerItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  checked?: boolean;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timeValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  selectedOptions?: unknown[] | Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class SaveInitialAssessmentAnswersDto {
  @ApiProperty({ type: [InitialAssessmentAnswerItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InitialAssessmentAnswerItemDto)
  answers!: InitialAssessmentAnswerItemDto[];
}
