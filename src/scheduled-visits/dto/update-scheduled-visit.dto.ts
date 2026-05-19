import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateScheduledVisitDto } from './create-scheduled-visit.dto';

export class UpdateScheduledVisitDto extends PartialType(
  OmitType(CreateScheduledVisitDto, ['scheduledJobId', 'serviceUserId'] as const),
) {}
