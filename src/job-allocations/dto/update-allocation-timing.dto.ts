import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAllocationTimingDto {
  @ApiPropertyOptional({ description: 'Assignment start (ISO), within the job visit window' })
  @IsOptional()
  @IsISO8601()
  scheduledStartDateTime?: string;

  @ApiPropertyOptional({ description: 'Assignment end (ISO), within the job visit window' })
  @IsOptional()
  @IsISO8601()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLeadCarer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
