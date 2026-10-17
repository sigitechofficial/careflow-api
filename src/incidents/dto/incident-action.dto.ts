import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentActionPriority, IncidentActionStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { INCIDENT_MEASURE_ADDRESSES, INCIDENT_MEASURE_TYPES } from '../incident-review.constants';

export class CreateIncidentActionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @ApiPropertyOptional({
    enum: IncidentActionPriority,
    default: IncidentActionPriority.MEDIUM,
  })
  @IsOptional()
  @IsEnum(IncidentActionPriority)
  priority?: IncidentActionPriority;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Assigned employee id' })
  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @ApiPropertyOptional({
    description: 'Mandatory actions block High/Critical closure',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({ enum: INCIDENT_MEASURE_TYPES, description: 'What the measure changes' })
  @IsOptional()
  @IsIn(INCIDENT_MEASURE_TYPES)
  measureType?: string;

  @ApiPropertyOptional({
    description: 'Records the measure relates to: [{ id, label }] (name as at save time)',
    type: Object,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  linkedRecords?: unknown[];

  @ApiPropertyOptional({
    enum: INCIDENT_MEASURE_ADDRESSES,
    isArray: true,
    description: 'Investigation findings it addresses (ROOT_CAUSE and/or contributing factors)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INCIDENT_MEASURE_ADDRESSES, { each: true })
  addresses?: string[];

  @ApiPropertyOptional({
    description:
      'Care plan / risk assessment / policy measures: a new record is needed instead of updating one',
  })
  @IsOptional()
  @IsBoolean()
  newRecordNeeded?: boolean;

  @ApiPropertyOptional({ description: 'COURSE measures: the carer to take the course' })
  @ValidateIf((o: CreateIncidentActionDto) => o.measureType === 'COURSE')
  @IsUUID()
  courseEmployeeId?: string;

  @ApiPropertyOptional({ description: 'COURSE measures: the published course' })
  @ValidateIf((o: CreateIncidentActionDto) => o.measureType === 'COURSE')
  @IsUUID()
  courseId?: string;
}

export class UpdateIncidentActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string | null;

  @ApiPropertyOptional({ enum: IncidentActionPriority })
  @IsOptional()
  @IsEnum(IncidentActionPriority)
  priority?: IncidentActionPriority;

  @ApiPropertyOptional({ enum: IncidentActionStatus })
  @IsOptional()
  @IsEnum(IncidentActionStatus)
  status?: IncidentActionStatus;

  @ApiPropertyOptional({
    description: 'Due date (ISO 8601). Null or empty clears the due date.',
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsISO8601()
  dueDate?: string | null;

  @ApiPropertyOptional({
    description: 'Assigned employee id. Null or empty clears the assignee.',
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  assignedEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Records the measure relates to: [{ id, label }] (not for COURSE measures)',
    type: Object,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  linkedRecords?: unknown[];

  @ApiPropertyOptional({
    description:
      'Care plan / risk assessment / policy measures: a new record is needed instead of updating one',
  })
  @IsOptional()
  @IsBoolean()
  newRecordNeeded?: boolean;

  @ApiPropertyOptional({ enum: INCIDENT_MEASURE_ADDRESSES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INCIDENT_MEASURE_ADDRESSES, { each: true })
  addresses?: string[];

  @ApiPropertyOptional({
    description: 'Required when cancelling a mandatory measure or making it optional (audited)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class CompleteIncidentActionDto {
  @ApiProperty({ description: 'How the measure was completed (the evidence it was done)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  completionNotes!: string;

  @ApiPropertyOptional({
    description:
      'Care plan / risk assessment / policy measures: the record(s) actually updated or added [{ id, label }] (required for those types)',
    type: Object,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  completedRecords?: unknown[];

  @ApiPropertyOptional({
    description:
      'Care plan update measures: the published care plan version that made the change (required)',
  })
  @IsOptional()
  @IsUUID()
  carePlanVersionId?: string;
}

export class RemoveIncidentActionDto {
  @ApiProperty({ description: 'Why the measure is removed (kept in the audit log)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
