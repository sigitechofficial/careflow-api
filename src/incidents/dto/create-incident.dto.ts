import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentPersonKind,
  IncidentPrivacyLevel,
  IncidentSeverity,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IMMEDIATE_ACTION_CODES,
  OFFICE_WHO_INFORMED_KEYS,
} from '../incident-workflow.util';

export class CreateIncidentDto {
  @ApiProperty({ description: 'Incident category id (IncidentCategory)' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({
    description: 'Incident subtype id (must belong to the category)',
  })
  @IsOptional()
  @IsUUID()
  subtypeId?: string;

  @ApiProperty({
    description: 'When the incident occurred (ISO 8601 date-time)',
  })
  @IsISO8601()
  occurredAt!: string;

  @ApiPropertyOptional({ description: 'Location id (lookups.Location)' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Specific area / location description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specificArea?: string;

  @ApiPropertyOptional({
    description: 'Primary person affected — service user id',
  })
  @IsOptional()
  @IsUUID()
  primaryServiceUserId?: string;

  @ApiPropertyOptional({ description: 'Primary person affected — employee id' })
  @IsOptional()
  @IsUUID()
  primaryEmployeeId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'All service users involved; the first becomes the primary person when none is set',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'All staff members involved; the first becomes the primary employee when none is set',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({
    enum: IncidentPersonKind,
    description: 'Kind of primary person affected',
  })
  @IsOptional()
  @IsEnum(IncidentPersonKind)
  primaryPersonKind?: IncidentPersonKind;

  @ApiPropertyOptional({
    enum: IncidentPersonKind,
    isArray: true,
    description: 'All kinds of person affected (multi-select)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsEnum(IncidentPersonKind, { each: true })
  affectedPersonKinds?: IncidentPersonKind[];

  @ApiPropertyOptional({
    description:
      'Name of the primary person affected when not a platform record (Family/Visitor/Other)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  primaryPersonName?: string;

  @ApiProperty({
    description:
      'Carer who reported the incident. Incidents are always reported by a carer; the office only records them.',
  })
  @IsUUID()
  reporterEmployeeId!: string;

  @ApiPropertyOptional({
    description:
      'Category-specific answers, validated per category key (see incident-category-details.util.ts)',
  })
  @IsOptional()
  @IsObject()
  categoryDetails?: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ambulance attended? null = not known',
  })
  @IsOptional()
  @IsBoolean()
  ambulanceAttended?: boolean | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Taken to A&E? null = not known',
  })
  @IsOptional()
  @IsBoolean()
  takenToAe?: boolean | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Admitted to hospital? null = not known',
  })
  @IsOptional()
  @IsBoolean()
  admittedToHospital?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Visit (scheduled job) during which it happened or was discovered — must belong to the service user',
  })
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;

  @ApiProperty({ description: 'What happened' })
  @IsString()
  @MaxLength(8000)
  description!: string;

  @ApiPropertyOptional({ description: 'What happened immediately before' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  contextBefore?: string;

  @ApiPropertyOptional({ description: 'What happened immediately afterwards' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  contextAfter?: string;

  @ApiPropertyOptional({
    description:
      'Description of the actions taken (required when OTHER is ticked)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  immediateActions?: string;

  @ApiPropertyOptional({ enum: IMMEDIATE_ACTION_CODES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(IMMEDIATE_ACTION_CODES, { each: true })
  immediateActionCodes?: string[];

  @ApiPropertyOptional({ enum: OFFICE_WHO_INFORMED_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(OFFICE_WHO_INFORMED_KEYS, { each: true })
  whoInformedKeys?: string[];

  @ApiPropertyOptional({ description: 'Whether anyone was injured' })
  @IsOptional()
  @IsBoolean()
  injuryOccurred?: boolean;

  @ApiPropertyOptional({
    enum: IncidentSeverity,
    default: IncidentSeverity.LOW,
  })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional({
    enum: IncidentPrivacyLevel,
    default: IncidentPrivacyLevel.NORMAL,
  })
  @IsOptional()
  @IsEnum(IncidentPrivacyLevel)
  privacyLevel?: IncidentPrivacyLevel;

  @ApiPropertyOptional({
    description: 'Share a safe summary with the shift handover',
  })
  @IsOptional()
  @IsBoolean()
  shareWithHandover?: boolean;
}
