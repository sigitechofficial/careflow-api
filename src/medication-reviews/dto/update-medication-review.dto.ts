import { PartialType } from '@nestjs/swagger';
import { CreateMedicationReviewDto } from './create-medication-review.dto';

export class UpdateMedicationReviewDto extends PartialType(CreateMedicationReviewDto) {}
