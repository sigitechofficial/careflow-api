import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SurveyStatus } from '@prisma/client';
import { CreateSurveyDto } from './create-survey.dto';

export class UpdateSurveyDto extends PartialType(CreateSurveyDto) {
  @ApiPropertyOptional({ enum: SurveyStatus })
  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;
}
