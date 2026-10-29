import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AiFillQuestionOptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  value!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  label!: string;
}

export class AiFillQuestionDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  /** Options as shown in the form (lookups such as ethnicity are resolved by the admin app). */
  @ApiPropertyOptional({ type: [AiFillQuestionOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => AiFillQuestionOptionDto)
  options?: AiFillQuestionOptionDto[];
}

export class InitialAssessmentAiFillDto {
  @ApiProperty({ description: 'Transcript of the assessment conversation' })
  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  transcript!: string;

  @ApiProperty({
    type: [AiFillQuestionDto],
    description: 'Questions to fill (the open form tab)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(600)
  @ValidateNested({ each: true })
  @Type(() => AiFillQuestionDto)
  questions!: AiFillQuestionDto[];
}
