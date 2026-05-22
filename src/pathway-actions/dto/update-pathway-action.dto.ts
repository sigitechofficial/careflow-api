import { PartialType } from '@nestjs/swagger';
import { CreatePathwayActionDto } from './create-pathway-action.dto';

export class UpdatePathwayActionDto extends PartialType(CreatePathwayActionDto) {}
