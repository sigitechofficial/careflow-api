import { PartialType } from '@nestjs/swagger';
import { CreateMedicationAllergyDto } from './create-medication-allergy.dto';

export class UpdateMedicationAllergyDto extends PartialType(CreateMedicationAllergyDto) {}
