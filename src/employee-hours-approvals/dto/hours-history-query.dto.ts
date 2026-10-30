import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const HOURS_HISTORY_GROUPS = ['carer', 'service_user'] as const;
export const HOURS_HISTORY_KINDS = [
  'EXTRA_HOURS',
  'HOURS_REQUEST',
  'EXTRA_VISIT',
  'SPECIAL_VISIT',
] as const;
export type HoursHistoryKind = (typeof HOURS_HISTORY_KINDS)[number];

export class HoursHistoryQueryDto {
  @ApiPropertyOptional({ enum: HOURS_HISTORY_GROUPS, default: 'carer' })
  @IsOptional()
  @IsIn(HOURS_HISTORY_GROUPS)
  group?: (typeof HOURS_HISTORY_GROUPS)[number];

  @ApiPropertyOptional({ example: '2026-10-01', description: 'First day (defaults to the 1st of this month).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day (defaults to today).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: HOURS_HISTORY_KINDS })
  @IsOptional()
  @IsIn(HOURS_HISTORY_KINDS)
  kind?: HoursHistoryKind;

  @ApiPropertyOptional({ description: 'Carer or service user name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
