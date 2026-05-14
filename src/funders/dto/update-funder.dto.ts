import { PartialType } from '@nestjs/swagger';
import { CreateFunderDto } from './create-funder.dto';

export class UpdateFunderDto extends PartialType(CreateFunderDto) {}
