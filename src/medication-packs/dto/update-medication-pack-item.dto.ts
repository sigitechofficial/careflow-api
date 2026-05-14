import { PartialType } from '@nestjs/swagger';
import { CreateMedicationPackItemDto } from './create-medication-pack-item.dto';

export class UpdateMedicationPackItemDto extends PartialType(CreateMedicationPackItemDto) {}
