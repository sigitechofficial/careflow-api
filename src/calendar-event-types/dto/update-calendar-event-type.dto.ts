import { PartialType } from '@nestjs/swagger';
import { CreateCalendarEventTypeDto } from './create-calendar-event-type.dto';

export class UpdateCalendarEventTypeDto extends PartialType(CreateCalendarEventTypeDto) {}
