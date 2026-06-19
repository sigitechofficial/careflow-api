import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { GenerateVisitPlanScheduleDto } from './generate-visit-plan-schedule.dto';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class BulkGenerateVisitPlanScheduleDto extends GenerateVisitPlanScheduleDto {
  @ApiPropertyOptional({
    description: 'Generate only for these visit plan ids. When omitted, all active plans are eligible.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  planIds?: string[];

  @ApiPropertyOptional({ description: 'Filter eligible plans by service user location' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Skip plans that are not ready (enabled slots, times and days set)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseOptionalBoolean(value))
  readyOnly?: boolean;
}
