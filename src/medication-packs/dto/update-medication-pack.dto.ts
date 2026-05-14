import { PartialType } from '@nestjs/swagger';
import { CreateMedicationPackDto } from './create-medication-pack.dto';

export class UpdateMedicationPackDto extends PartialType(CreateMedicationPackDto) {}
