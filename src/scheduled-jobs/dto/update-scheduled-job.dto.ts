import { PartialType } from '@nestjs/swagger';
import { CreateScheduledJobDto } from './create-scheduled-job.dto';

export class UpdateScheduledJobDto extends PartialType(CreateScheduledJobDto) {}
