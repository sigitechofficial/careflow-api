import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CalendarView } from '../enums/calendar-view.enum';
import { CalendarEventStatus } from '../enums/calendar-event-status.enum';

export class CalendarViewQueryDto {
  @ApiProperty({ enum: CalendarView, example: CalendarView.MONTH })
  @IsEnum(CalendarView)
  view!: CalendarView;

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @ApiPropertyOptional({ enum: CalendarEventStatus })
  @IsOptional()
  @IsEnum(CalendarEventStatus)
  status?: CalendarEventStatus;
}
