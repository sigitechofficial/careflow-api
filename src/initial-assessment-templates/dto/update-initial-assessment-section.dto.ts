import { PartialType } from '@nestjs/swagger';
import { CreateInitialAssessmentSectionDto } from './create-initial-assessment-section.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateInitialAssessmentSectionDto extends PartialType(CreateInitialAssessmentSectionDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
