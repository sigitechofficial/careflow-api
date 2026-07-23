import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const SERVICE_USER_HOUR_BANDS = [
  'under_10',
  '10_20',
  '20_30',
  '30_40',
  'over_40',
] as const;

export type ServiceUserHourBand = (typeof SERVICE_USER_HOUR_BANDS)[number];

export const SERVICE_USER_HOUR_METRICS = ['worked', 'assigned', 'package'] as const;
export type ServiceUserHourMetric = (typeof SERVICE_USER_HOUR_METRICS)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class ServiceUserHoursWeeklyQueryDto {
  @ApiPropertyOptional({
    example: '2026-07-13',
    description: 'Any date in the ISO week (Monday–Sunday). Defaults to current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  @ApiPropertyOptional({ enum: SERVICE_USER_HOUR_BANDS })
  @IsOptional()
  @IsIn(SERVICE_USER_HOUR_BANDS)
  hourBand?: ServiceUserHourBand;

  @ApiPropertyOptional({
    enum: SERVICE_USER_HOUR_METRICS,
    description: 'Which metric the hourBand filter applies to (default: assigned)',
  })
  @IsOptional()
  @IsIn(SERVICE_USER_HOUR_METRICS)
  bandMetric?: ServiceUserHourMetric;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by branch/location id' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by care type id' })
  @IsOptional()
  @IsUUID()
  careTypeId?: string;

  @ApiPropertyOptional({ description: 'Filter by funding type id' })
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional({ description: 'Filter by service user status id' })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    description: 'Only service users whose assigned hours exceed package (contracted) hours',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overPackageOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Only service users whose worked hours exceed package (contracted) hours',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overWorkedOnly?: boolean;

  @ApiPropertyOptional({ description: 'When true, include inactive service users' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}
