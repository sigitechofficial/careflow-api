import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserMedicationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  roundId!: string | null;

  @ApiPropertyOptional({ example: '08:00', nullable: true })
  dueTime!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dueVisitName!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  startDate!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endDate!: Date | null;

  @ApiProperty({ type: [String], example: ['MON', 'WED', 'FRI'] })
  daysOfWeek!: string[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ description: 'Included round and frequency relations' })
  round?: unknown;

  @ApiPropertyOptional()
  frequency?: unknown;
}

export class MedicationScheduleDeleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: true })
  deleted!: boolean;
}
