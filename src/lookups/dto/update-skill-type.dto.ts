import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateSkillTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Suggested skill refresh interval in months; null = no default', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Transform(({ value }) => (value === '' ? null : value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  defaultRefreshMonths?: number | null;
}
