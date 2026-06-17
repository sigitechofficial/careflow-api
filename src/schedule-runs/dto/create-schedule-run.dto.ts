import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateScheduleRunDto {
  @ApiPropertyOptional({ description: 'Resolved from runDate when omitted' })
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional({ description: 'Assigned carer (employee)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Run notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2026-05-05' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  runDate!: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  endTime?: string;

  @ApiPropertyOptional({ example: 'morning' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  shiftType?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Scheduled job IDs (visits) to add to the run in order',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  visitIds?: string[];
}
