import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CreateLookupNameDto } from './create-lookup-name.dto';

/**
 * Rename a manageable lookup and, for the three interval lookups, set its default interval.
 * Send null to clear an interval; leave a field out to keep it. An interval sent for a
 * resource that has none (e.g. job-titles) is refused.
 */
export class UpdateNamedLookupDto extends CreateLookupNameDto {
  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 3650,
    description: 'review-types only: days from last done to next due (e.g. 90 for supervision)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  defaultIntervalDays?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 120, description: 'skill-types only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  defaultRefreshMonths?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 240, description: 'certification-types only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  defaultValidityMonths?: number | null;
}
