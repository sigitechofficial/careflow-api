import { PartialType } from '@nestjs/swagger';
import { CreateCarePlanTextTemplateDto } from './create-care-plan-text-template.dto';

export class UpdateCarePlanTextTemplateDto extends PartialType(CreateCarePlanTextTemplateDto) {}
