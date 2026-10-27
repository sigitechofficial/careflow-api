import { OmitType } from '@nestjs/swagger';
import {
  PauseIncidentInvestigationDto,
  UpsertIncidentInvestigationDto,
} from '../../incidents/dto/incident-review.dto';

/** Same fields and rules as the incident investigation, without the old internal/external scope. */
export class UpsertSafeguardingInvestigationDto extends OmitType(UpsertIncidentInvestigationDto, [
  'investigationScope',
  'externalType',
] as const) {}

export class PauseSafeguardingInvestigationDto extends PauseIncidentInvestigationDto {}
