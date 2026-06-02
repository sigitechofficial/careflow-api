import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SchedulePreviewPerScheduleDto {
  @ApiProperty({ example: '08:00' })
  dueTime!: string;

  @ApiProperty({ example: 'Morning' })
  timeSlotLabel!: string;

  @ApiProperty({ example: 30 })
  dueSlotCount!: number;
}

export class SchedulePreviewResultDto {
  @ApiProperty({ example: '2026-05-01' })
  from!: string;

  @ApiProperty({ example: '2026-05-30' })
  to!: string;

  @ApiProperty({ example: 30 })
  dayCount!: number;

  @ApiProperty({ example: 90 })
  totalDueSlots!: number;

  @ApiProperty({ example: 3 })
  schedulesCount!: number;

  @ApiProperty({ type: [SchedulePreviewPerScheduleDto] })
  perSchedule!: SchedulePreviewPerScheduleDto[];

  @ApiProperty({
    enum: ['daily', 'weekly', 'specific', 'prn', 'interval', 'monthly'],
  })
  scheduleType!: string;

  @ApiProperty({ example: 'Daily · 3 time slots · 90 administrations over 30 days' })
  summaryLabel!: string;

  @ApiPropertyOptional()
  prnNote?: string;
}

export class MedicationSchedulePreviewResponseDto {
  @ApiProperty({ type: SchedulePreviewResultDto })
  data!: SchedulePreviewResultDto;
}
