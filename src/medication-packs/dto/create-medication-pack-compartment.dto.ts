import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateMedicationPackCompartmentDto {
  @ApiProperty({ maxLength: 60, example: 'Morning' })
  @IsString()
  @MaxLength(60)
  label!: string;

  @ApiProperty({ example: '08:00', description: 'Exact due time (HH:mm)' })
  @Matches(TIME_RE, { message: 'dueTime must be HH:mm' })
  dueTime!: string;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @Matches(TIME_RE, { message: 'windowStart must be HH:mm' })
  windowStart?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @Matches(TIME_RE, { message: 'windowEnd must be HH:mm' })
  windowEnd?: string;

  @ApiPropertyOptional({ default: 0, description: 'Minutes after window end before a record is late' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lateThresholdMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  witnessRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
