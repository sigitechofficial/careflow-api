import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class ServiceUserTimelineQueryDto {
  @ApiPropertyOptional({ example: '2026-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ example: '2026-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
