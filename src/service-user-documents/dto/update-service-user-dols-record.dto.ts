import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceUserDolsRecordDto } from './create-service-user-dols-record.dto';

export class UpdateServiceUserDolsRecordDto extends PartialType(CreateServiceUserDolsRecordDto) {}
