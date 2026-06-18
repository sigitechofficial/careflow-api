import { PartialType } from '@nestjs/swagger';
import { CreateScheduleRunDto } from './create-schedule-run.dto';

export class UpdateScheduleRunDto extends PartialType(CreateScheduleRunDto) {}
