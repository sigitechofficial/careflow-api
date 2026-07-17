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

export const EMPLOYEE_HOUR_BANDS = [
  'under_10',
  '10_20',
  '20_30',
  '30_40',
  'over_40',
] as const;

export type EmployeeHourBand = (typeof EMPLOYEE_HOUR_BANDS)[number];

export const EMPLOYEE_HOUR_METRICS = ['worked', 'assigned', 'weekly'] as const;
export type EmployeeHourMetric = (typeof EMPLOYEE_HOUR_METRICS)[number];

export const EMPLOYEE_STAFF_KINDS = ['all', 'permanent', 'bank', 'agency'] as const;
export type EmployeeStaffKind = (typeof EMPLOYEE_STAFF_KINDS)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class EmployeeHoursWeeklyQueryDto {
  @ApiPropertyOptional({
    example: '2026-07-13',
    description: 'Any date in the ISO week (Monday–Sunday). Defaults to current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_HOUR_BANDS })
  @IsOptional()
  @IsIn(EMPLOYEE_HOUR_BANDS)
  hourBand?: EmployeeHourBand;

  @ApiPropertyOptional({
    enum: EMPLOYEE_HOUR_METRICS,
    description: 'Which metric the hourBand filter applies to (default: worked)',
  })
  @IsOptional()
  @IsIn(EMPLOYEE_HOUR_METRICS)
  bandMetric?: EmployeeHourMetric;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by employment role lookup id' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Filter by job title id' })
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional({ description: 'Filter by contract type id' })
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional({ description: 'Filter by branch/location id (base or working location)' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by immigration / visa type id' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  visaTypeId?: string;

  @ApiPropertyOptional({
    enum: EMPLOYEE_STAFF_KINDS,
    description: 'Staff kind filter (default: all)',
  })
  @IsOptional()
  @IsIn(EMPLOYEE_STAFF_KINDS)
  staffKind?: EmployeeStaffKind;

  @ApiPropertyOptional({ description: 'Only employees whose worked hours exceed contracted hours' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overContractOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only employees whose worked hours exceed their weekly cap' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overCapOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only employees with worked hours above 40' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  over40Only?: boolean;

  @ApiPropertyOptional({ description: 'When true, include inactive employees' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}
