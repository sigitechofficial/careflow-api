import { PartialType } from '@nestjs/swagger';
import { CreateInitialAssessmentQuestionDto } from './create-initial-assessment-question.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateInitialAssessmentQuestionDto extends PartialType(CreateInitialAssessmentQuestionDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
