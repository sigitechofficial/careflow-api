import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CalendarEventStatus } from '../enums/calendar-event-status.enum';

export class UpdateCalendarEventStatusDto {
  @ApiProperty({ enum: CalendarEventStatus })
  @IsEnum(CalendarEventStatus)
  status!: CalendarEventStatus;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
