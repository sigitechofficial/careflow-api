import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Open for responses / publish (also reopen). A survey whose end date has passed is refused unless
 * a new end date (in the future) is given here, or the end date is removed (null) — otherwise the
 * survey job would close it again within a minute.
 */
export class ReopenSurveyDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'New end date (ISO, in the future), or null to remove it. Leave out to keep the current one.',
  })
  @IsOptional()
  @IsISO8601()
  closesAt?: string | null;
}
