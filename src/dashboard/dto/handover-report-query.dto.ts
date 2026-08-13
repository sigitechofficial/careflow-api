import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class HandoverReportQueryDto {
  @ApiPropertyOptional({ example: '2026-05-07', description: 'Inclusive from date (YYYY-MM-DD). Defaults to settings window.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-05-08', description: 'Inclusive to date (YYYY-MM-DD). Defaults to today (org TZ).' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by service user name (partial, case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceUserName?: string;

  @ApiPropertyOptional({ enum: ['name', 'earliest', 'latest'], default: 'latest' })
  @IsOptional()
  @IsIn(['name', 'earliest', 'latest'])
  sortBy?: 'name' | 'earliest' | 'latest';
}
