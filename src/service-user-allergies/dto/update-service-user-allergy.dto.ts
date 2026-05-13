import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceUserAllergyDto } from './create-service-user-allergy.dto';

export class UpdateServiceUserAllergyDto extends PartialType(CreateServiceUserAllergyDto) {}
