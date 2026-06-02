import { PartialType } from '@nestjs/swagger';
import { CreateMedicationPackCompartmentDto } from './create-medication-pack-compartment.dto';

export class UpdateMedicationPackCompartmentDto extends PartialType(CreateMedicationPackCompartmentDto) {}
