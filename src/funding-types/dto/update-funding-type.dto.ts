import { PartialType } from '@nestjs/swagger';
import { CreateFundingTypeDto } from './create-funding-type.dto';

export class UpdateFundingTypeDto extends PartialType(CreateFundingTypeDto) {}
