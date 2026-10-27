import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class CreateSpecialistPathwayPlanDto {
  @ApiPropertyOptional({
    description: 'Plan body (free-form; e.g. { summary, goals[], support[] }).',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}
