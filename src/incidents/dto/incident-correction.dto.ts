import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentClarificationField,
  IncidentPersonKind,
  IncidentSeverity,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IMMEDIATE_ACTION_CODES,
  OFFICE_WHO_INFORMED_KEYS,
} from '../incident-workflow.util';

/**
 * Correct raised details. Only the fields sent are changed (omit = unchanged, null = clear).
 * The reporter's own account (what happened / before / afterwards / free-text actions / people
 * involved / emergency services), reporter, recorder, times and reference can't be sent at all —
 * those are corrected with a clarification note instead.
 */
export class CorrectIncidentDto {
  @ApiProperty({ description: 'Why the details are being corrected (kept with every change)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ description: 'When it happened (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  subtypeId?: string | null;

  @ApiPropertyOptional({ enum: IncidentPersonKind, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsEnum(IncidentPersonKind, { each: true })
  affectedPersonKinds?: IncidentPersonKind[];

  @ApiPropertyOptional({ nullable: true, description: 'Service user affected' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  primaryServiceUserId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Staff member affected' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  primaryEmployeeId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Name of another person affected' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  primaryPersonName?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Every service user involved (the affected one is added first automatically)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Every staff member involved (the affected one is added first automatically)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ nullable: true, description: 'Branch' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Visit (scheduled job)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  scheduledJobId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Category-specific answers — required again when the category changes',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  categoryDetails?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  ambulanceAttended?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  takenToAe?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  admittedToHospital?: boolean | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(IMMEDIATE_ACTION_CODES, { each: true })
  immediateActionCodes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(OFFICE_WHO_INFORMED_KEYS, { each: true })
  whoInformedKeys?: string[];

  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;
}

export class AddIncidentClarificationDto {
  @ApiProperty({ enum: IncidentClarificationField })
  @IsEnum(IncidentClarificationField)
  field!: IncidentClarificationField;

  @ApiProperty({ description: 'The clarification (the original text is never changed)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}
