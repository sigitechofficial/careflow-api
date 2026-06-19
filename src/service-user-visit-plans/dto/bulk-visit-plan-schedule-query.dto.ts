import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class BulkVisitPlanScheduleCandidatesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by service user location' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'When true, only return plans with enabled slots, times, and visit days set',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseOptionalBoolean(value))
  readyOnly?: boolean;
}
