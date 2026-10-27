import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateSpecialistPathwayPlanDto {
  @ApiPropertyOptional({
    description: 'Plan body (free-form). Only allowed while the plan is a DRAFT.',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Set true to submit the draft for approval (DRAFT -> SUBMITTED).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
