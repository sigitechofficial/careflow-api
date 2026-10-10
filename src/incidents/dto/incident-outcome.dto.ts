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
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { INCIDENT_OUTCOME_CHANGE_CODES } from '../incident-review.constants';
import { LEARNING_SHARED_METHODS } from '../incident-outcome.util';

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

  @ApiPropertyOptional({
    description:
      'Who the outcome was shared with: [{ key, personKind, name, shared, sharedOn, method, notSharedReason, note }]',
    type: Object,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  outcomeSharing?: unknown[];

  @ApiPropertyOptional({ nullable: true, description: 'When the learning was shared with the team (YYYY-MM-DD)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'learningSharedOn must be YYYY-MM-DD' })
  learningSharedOn?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: LEARNING_SHARED_METHODS })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(LEARNING_SHARED_METHODS)
  learningSharedMethod?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  learningSharedNote?: string | null;
}
