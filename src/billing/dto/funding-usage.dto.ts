import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

export class FundingUsageQueryDto {
  @ApiPropertyOptional({ enum: ['week', 'month'], default: 'month' })
  @IsOptional()
  @IsIn(['week', 'month'])
  period?: 'week' | 'month';

  @ApiPropertyOptional({ description: 'Any organisation day in the period (YYYY-MM-DD). Default: today.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}
