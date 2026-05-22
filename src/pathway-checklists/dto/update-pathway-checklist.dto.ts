import { PartialType } from '@nestjs/swagger';
import { CreatePathwayChecklistDto } from './create-pathway-checklist.dto';

export class UpdatePathwayChecklistDto extends PartialType(CreatePathwayChecklistDto) {}
