import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateReviewTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Default review interval in days; null = no default schedule', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Transform(({ value }) => (value === '' ? null : value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  defaultIntervalDays?: number | null;
}
