import { PartialType } from '@nestjs/swagger';
import { CreatePathwayChecklistItemBodyDto } from './create-pathway-checklist-item.dto';

export class UpdatePathwayChecklistItemDto extends PartialType(CreatePathwayChecklistItemBodyDto) {}
