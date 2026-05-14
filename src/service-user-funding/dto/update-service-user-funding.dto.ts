import { PartialType } from '@nestjs/swagger';
import { CreateServiceUserFundingDto } from './create-service-user-funding.dto';

export class UpdateServiceUserFundingDto extends PartialType(CreateServiceUserFundingDto) {}
