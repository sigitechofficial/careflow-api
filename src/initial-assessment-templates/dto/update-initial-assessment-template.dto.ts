import { PartialType } from '@nestjs/swagger';
import { CreateInitialAssessmentTemplateDto } from './create-initial-assessment-template.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateInitialAssessmentTemplateDto extends PartialType(CreateInitialAssessmentTemplateDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
