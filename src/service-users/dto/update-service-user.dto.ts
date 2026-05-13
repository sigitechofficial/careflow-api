import { PartialType } from '@nestjs/swagger';
import { CreateServiceUserDto } from './create-service-user.dto';

export class UpdateServiceUserDto extends PartialType(CreateServiceUserDto) {}
