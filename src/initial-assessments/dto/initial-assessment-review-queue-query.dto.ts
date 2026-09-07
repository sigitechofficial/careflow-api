import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class InitialAssessmentReviewQueueQueryDto {
  @ApiPropertyOptional({ description: 'Only submissions with overdue open actions' })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  overdueActionsOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Limit to service users at this branch location (header location scope)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
