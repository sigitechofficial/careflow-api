import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

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
}

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
