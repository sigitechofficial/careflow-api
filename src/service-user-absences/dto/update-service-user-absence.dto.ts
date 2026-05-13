import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceUserAbsenceDto } from './create-service-user-absence.dto';

export class UpdateServiceUserAbsenceDto extends PartialType(CreateServiceUserAbsenceDto) {}
