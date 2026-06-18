import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class EmployeeVisaTypeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ description: 'Maximum hours allowed per week for this immigration status', minimum: 0, maximum: 168 })
  @Transform(({ obj, value }) => {
    if (value !== undefined && value !== null && value !== '') return Number(value);
    if (obj.weeklyHours !== undefined && obj.weeklyHours !== null && obj.weeklyHours !== '') {
      return Number(obj.weeklyHours);
    }
    return value;
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(168)
  maxWeeklyHours!: number;

  @ApiPropertyOptional({
    description: 'Default contracted hours when selected; omit or null to leave unchanged',
    minimum: 0,
    maximum: 168,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(168)
  defaultContractedHours?: number | null;

  /** @deprecated Use maxWeeklyHours — accepted on read for legacy JSON. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weeklyHours?: number;

  /** Legacy serialised order — ignored on save. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}
