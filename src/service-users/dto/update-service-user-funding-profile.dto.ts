import { PartialType } from '@nestjs/swagger';
import { CreateServiceUserFundingProfileDto } from './create-service-user-funding-profile.dto';

export class UpdateServiceUserFundingProfileDto extends PartialType(CreateServiceUserFundingProfileDto) {}
