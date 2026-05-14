import { PartialType } from '@nestjs/swagger';
import { CreateMedicationScheduleDto } from './create-medication-schedule.dto';

export class UpdateMedicationScheduleDto extends PartialType(CreateMedicationScheduleDto) {}
