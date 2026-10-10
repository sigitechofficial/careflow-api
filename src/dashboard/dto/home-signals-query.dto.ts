import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MedicationAdministrationStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

/** Shared branch filter: intersected with the caller's assigned locations. */
class LocationFilterDto {
  @ApiPropertyOptional({ description: 'Limit to one branch (must be within the caller’s scope).' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class MedicationExceptionsQueryDto extends LocationFilterDto {
  @ApiPropertyOptional({ example: '2026-10-09', description: 'Inclusive from date (YYYY-MM-DD). Defaults to today (org TZ).' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-09', description: 'Inclusive to date (YYYY-MM-DD). Defaults to dateFrom.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['MISSED', 'REFUSED', 'NOT_GIVEN', 'HELD'], description: 'Only this outcome.' })
  @IsOptional()
  @IsIn([
    MedicationAdministrationStatus.MISSED,
    MedicationAdministrationStatus.REFUSED,
    MedicationAdministrationStatus.NOT_GIVEN,
    MedicationAdministrationStatus.HELD,
  ])
  status?: 'MISSED' | 'REFUSED' | 'NOT_GIVEN' | 'HELD';

  @ApiPropertyOptional({ description: 'Only doses a manager has not reviewed yet.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreviewedOnly?: boolean;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200, description: 'How many doses to list (counts always cover the whole range).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class MedicationOverviewQueryDto extends LocationFilterDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 90, description: 'Days back (including today) for dose and stock figures.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

export class OperationsOverviewQueryDto extends LocationFilterDto {}

export class UpcomingWindowQueryDto extends LocationFilterDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 180, description: 'Days ahead to look. Overdue items are always included.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number;
}

export class StaffOffQueryDto extends LocationFilterDto {
  @ApiPropertyOptional({ example: '2026-10-09', description: 'Day to check (YYYY-MM-DD). Defaults to today (org TZ).' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
