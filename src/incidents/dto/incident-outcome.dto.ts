import { ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentPreventability } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { INCIDENT_OUTCOME_CHANGE_CODES } from '../incident-review.constants';

export class UpsertIncidentOutcomeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  finalOutcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  lessonsLearned?: string;

  @ApiPropertyOptional({ enum: IncidentPreventability })
  @IsOptional()
  @IsEnum(IncidentPreventability)
  preventability?: IncidentPreventability;

  @ApiPropertyOptional({ enum: INCIDENT_OUTCOME_CHANGE_CODES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INCIDENT_OUTCOME_CHANGE_CODES, { each: true })
  changesMade?: string[];

  @ApiPropertyOptional({
    description:
      'Per ticked change: changed records ({ id, label }) and a note, e.g. { CARE_PLAN: { items: [{ id, label }], note } }',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  changesMadeDetails?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  informationSharedWithStaff?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  serviceUserInformed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nokInformed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  finalManagementComments?: string;
}
