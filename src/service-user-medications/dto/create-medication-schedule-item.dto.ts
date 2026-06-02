import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateMedicationScheduleItemDto {
  @ApiProperty({ description: 'HH:mm 24h', example: '08:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'dueTime must be HH:mm' })
  dueTime!: string;

  @ApiPropertyOptional({ description: 'Care plan action label', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  dueVisitName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roundId?: string;

  @ApiPropertyOptional({
    description: 'Dose for this administration time; falls back to medication dose when omitted',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Weekdays when pattern is weekly (e.g. MONDAY, FRIDAY)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];
}
