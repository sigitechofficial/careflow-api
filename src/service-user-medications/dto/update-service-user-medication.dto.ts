import { PartialType } from '@nestjs/swagger';
import { CreateServiceUserMedicationDto } from './create-service-user-medication.dto';

export class UpdateServiceUserMedicationDto extends PartialType(CreateServiceUserMedicationDto) {}
