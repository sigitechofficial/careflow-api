import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceUserInventoryItemDto } from './create-service-user-inventory-item.dto';

export class UpdateServiceUserInventoryItemDto extends PartialType(CreateServiceUserInventoryItemDto) {}
