import { PartialType } from '@nestjs/swagger';
import { CreateServiceUserContactDto } from './create-service-user-contact.dto';

export class UpdateServiceUserContactDto extends PartialType(CreateServiceUserContactDto) {}
