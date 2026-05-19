import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class EmployeeCapacityQueryDto {
  @ApiProperty({ example: '2026-05-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom!: string;

  @ApiProperty({ example: '2026-05-07' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  limit?: number = 100;
}
