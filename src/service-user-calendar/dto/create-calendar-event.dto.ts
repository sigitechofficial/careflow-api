import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { CalendarEventStatus } from '../enums/calendar-event-status.enum';

@ValidatorConstraint({ name: 'CalendarEventEndAfterStart', async: false })
class CalendarEventEndAfterStart implements ValidatorConstraintInterface {
  validate(endDateTime: string | undefined, args: ValidationArguments): boolean {
    if (!endDateTime) return true;
    const obj = args.object as { startDateTime?: string };
    if (!obj.startDateTime) return true;
    return new Date(endDateTime).getTime() > new Date(obj.startDateTime).getTime();
  }

  defaultMessage(): string {
    return 'endDateTime must be after startDateTime';
  }
}

export class CreateCalendarEventDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @ApiProperty({ example: '2026-05-15T10:00:00.000Z' })
  @IsDateString()
  startDateTime!: string;

  @ApiPropertyOptional({ example: '2026-05-15T11:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  @Validate(CalendarEventEndAfterStart)
  endDateTime?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ enum: CalendarEventStatus, default: CalendarEventStatus.SCHEDULED })
  @IsOptional()
  @IsEnum(CalendarEventStatus)
  status?: CalendarEventStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  recurrenceRule?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reminderBeforeMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyKeyWorker?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyNamedNurse?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  notifyManager?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
