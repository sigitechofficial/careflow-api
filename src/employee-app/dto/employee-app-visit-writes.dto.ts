import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IMMEDIATE_ACTION_CODES,
  INCIDENT_LOCATION_KEYS,
} from '../../incidents/incident-workflow.util';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

export class EmployeeAppUnableToStartDto {
  @ApiProperty({
    example: 'CLIENT_NOT_HOME',
    description:
      'Must match a code from GET details → data.unableToStart.reasons (care-not-delivered catalogue)',
  })
  @IsString()
  @MaxLength(64)
  reasonCode!: string;

  @ApiProperty({
    example: 'Knocked twice, called mobile — no answer',
    description: 'Required for all unable-to-start reasons',
  })
  @IsString()
  @MaxLength(4000)
  notes!: string;

  @ApiProperty({ example: '2026-08-07T06:05:00.000Z' })
  @IsISO8601()
  attemptedAt!: string;

  @ApiPropertyOptional({
    description: 'Optional legacy field — ignored (location already validated at check-in)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  contactAttemptCount?: number;

  @ApiPropertyOptional({
    description: 'Optional legacy field — not required (location already validated at check-in)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class EmployeeAppTaskChecklistItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  itemId!: string;

  @ApiProperty()
  @IsBoolean()
  checked!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  label?: string;
}

export class EmployeeAppSaveTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  taskKey?: string;

  @ApiProperty({ enum: ['COMPLETED', 'PARTIAL', 'DECLINED'] })
  @IsString()
  @MaxLength(32)
  outcome!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  outcomeReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /** Recorded measurement for value-input tasks (e.g. blood glucose). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  recordedValue?: string;

  /** Alias for recordedValue (mobile may send `value`). */
  @ApiPropertyOptional()
  @IsOptional()
  value?: string | number;

  @ApiPropertyOptional({ type: [EmployeeAppTaskChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeAppTaskChecklistItemDto)
  checklist?: EmployeeAppTaskChecklistItemDto[];

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  taskVersion?: number;
}

export class EmployeeAppMedicationAdminDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  medicationKey?: string;

  @ApiProperty({ example: 'G' })
  @IsString()
  @MaxLength(16)
  outcomeCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  outcomeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supportLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ example: '09:15', description: 'Clock-face time given (HH:mm)' })
  @IsOptional()
  @IsString()
  // The app sends HH:mm (5 chars); allow headroom so a future time format
  // (e.g. with seconds or a locale AM/PM suffix) does not silently 400.
  @MaxLength(8)
  timeGiven?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prnIndication?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prnEffectiveness?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allergyAcknowledged?: boolean;

  @ApiPropertyOptional({
    description:
      'Controlled-drug witness. false = No. true = Yes (name + relation required). Omitted = not asked.',
  })
  @IsOptional()
  @IsBoolean()
  witnessPresent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  witnessName?: string;

  @ApiPropertyOptional({ example: 'RELATIVE', description: 'CO_CARER | RELATIVE | OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  witnessRelationCode?: string;

  @ApiPropertyOptional({ description: 'Required when relation is RELATIVE (son, daughter, …)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  witnessRelationDetail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  witnessNotes?: string;

  @ApiProperty()
  @IsBoolean()
  identityConfirmed!: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class EmployeeAppObservationWriteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  definitionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeCode?: string;

  @ApiPropertyOptional({ enum: ['recorded', 'unable'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  outcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  secondaryValue?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unableReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  abnormal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  critical?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  escalationAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emergencyProtocolOpened?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deviceRecordedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correctionReason?: string;

  /** Legacy admin DTO fields (accepted without 400). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observationTypeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareTargetCodes?: string[];
}

export class EmployeeAppLogNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;

  @ApiPropertyOptional({
    description:
      'Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  voiceNoteId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  voiceNoteIds?: string[];

  @ApiPropertyOptional({
    description: 'Total length in ms of the voice notes (timeline label for voice-only entries)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3 * 10 * 60 * 1000)
  voiceNoteDurationMs?: number;
}

export class EmployeeAppLogHandoverDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional({ enum: ['normal', 'high'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outstandingAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;

  @ApiPropertyOptional({
    description:
      'Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  voiceNoteId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  voiceNoteIds?: string[];

  @ApiPropertyOptional({
    description: 'Total length in ms of the voice notes (timeline label for voice-only entries)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3 * 10 * 60 * 1000)
  voiceNoteDurationMs?: number;
}

export class EmployeeAppLogConcernDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  concernType?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  escalationAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  officeContactPlanned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;

  @ApiPropertyOptional({
    description:
      'Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  voiceNoteId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  voiceNoteIds?: string[];

  @ApiPropertyOptional({
    description: 'Total length in ms of the voice notes (timeline label for voice-only entries)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3 * 10 * 60 * 1000)
  voiceNoteDurationMs?: number;
}

export class EmployeeAppIncidentBodyMapMarkDto {
  @ApiProperty({ example: 'dual' })
  @IsString()
  @MaxLength(64)
  view!: string;

  @ApiProperty({ example: 38.5, description: '0–100 percent' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @ApiProperty({ example: 22.1, description: '0–100 percent' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @ApiProperty({ example: 'Left shoulder' })
  @IsString()
  @MaxLength(200)
  part!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  canvasView?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  recordView?: string;
}

export class EmployeeAppIncidentBodyMapDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  regions!: string[];

  @ApiPropertyOptional({ type: [EmployeeAppIncidentBodyMapMarkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeAppIncidentBodyMapMarkDto)
  marks?: EmployeeAppIncidentBodyMapMarkDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** One injury on a carer-app incident — the same shape as the office "Add injury" dialog. */
export class EmployeeAppIncidentInjuryDto {
  @ApiProperty({ enum: ['SERVICE_USER', 'EMPLOYEE', 'OTHER'] })
  @IsIn(['SERVICE_USER', 'EMPLOYEE', 'OTHER'])
  personKind!: 'SERVICE_USER' | 'EMPLOYEE' | 'OTHER';

  @ApiPropertyOptional({ description: 'Staff member on this visit (personKind EMPLOYEE)' })
  @IsOptional()
  @IsUUID()
  personEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Name when personKind is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  personName?: string;

  @ApiProperty({ example: 'Bruise' })
  @IsString()
  @MaxLength(120)
  injuryType!: string;

  @ApiProperty({ enum: ['MINOR', 'MODERATE', 'SERIOUS'] })
  @IsIn(['MINOR', 'MODERATE', 'SERIOUS'])
  injurySeverity!: 'MINOR' | 'MODERATE' | 'SERIOUS';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bodyRegion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    type: EmployeeAppIncidentBodyMapMarkDto,
    description: 'Body-map pin (service user only)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeAppIncidentBodyMapMarkDto)
  mark?: EmployeeAppIncidentBodyMapMarkDto;
}

export class EmployeeAppIncidentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  incidentType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  incidentTypeKey?: string;

  @ApiPropertyOptional({ description: 'Incident subtype id (belongs to the type/category)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subtypeKey?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  severityKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  incidentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  incidentTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  injuryInfo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  immediateAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  peopleInvolved?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  witnesses?: string;

  @ApiPropertyOptional({ description: 'What happened immediately before' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  contextBefore?: string;

  @ApiPropertyOptional({ description: 'What happened afterwards' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  contextAfter?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Kinds of person affected (SERVICE_USER/EMPLOYEE/FAMILY/VISITOR/HEALTHCARE_PROFESSIONAL/CONTRACTOR/OTHER) — multi-select',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affectedPersonKinds?: string[];

  @ApiPropertyOptional({
    description: 'Name of the primary person affected when not a platform record',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  affectedPersonName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  emergencyServices?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  familyInformed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  safeguardingConcern?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whoInformed?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whoInformedKeys?: string[];

  @ApiPropertyOptional({ description: 'Additional notes from the carer' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  notes?: string;

  @ApiPropertyOptional({ type: EmployeeAppIncidentBodyMapDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeAppIncidentBodyMapDto)
  bodyMap?: EmployeeAppIncidentBodyMapDto;

  // ── Same questions as the office Raise form (newer app builds) ─────────────

  @ApiPropertyOptional({ enum: INCIDENT_LOCATION_KEYS, description: 'Where did it happen?' })
  @IsOptional()
  @IsIn(INCIDENT_LOCATION_KEYS)
  locationKey?: string;

  @ApiPropertyOptional({ description: 'Where, when locationKey is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationDetail?: string;

  @ApiPropertyOptional({ enum: IMMEDIATE_ACTION_CODES, isArray: true, description: 'What was done?' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(IMMEDIATE_ACTION_CODES, { each: true })
  immediateActionCodes?: string[];

  @ApiPropertyOptional({ nullable: true, description: 'Ambulance attended? null = not known' })
  @IsOptional()
  @IsBoolean()
  ambulanceAttended?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'Taken to A&E? null = not known' })
  @IsOptional()
  @IsBoolean()
  takenToAe?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'Admitted to hospital? null = not known' })
  @IsOptional()
  @IsBoolean()
  admittedToHospital?: boolean | null;

  @ApiPropertyOptional({
    description: 'Category-specific answers (same keys as the office form; "not sure" = left out)',
  })
  @IsOptional()
  @IsObject()
  categoryDetails?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Staff member affected (a carer on this visit; default the reporter)' })
  @IsOptional()
  @IsUUID()
  affectedEmployeeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Other carers on this visit who were involved' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  involvedEmployeeIds?: string[];

  @ApiPropertyOptional({ type: [EmployeeAppIncidentInjuryDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EmployeeAppIncidentInjuryDto)
  injuries?: EmployeeAppIncidentInjuryDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;
}

/** A carer-app incident reported outside a visit (Me tab). */
export class EmployeeAppStandaloneIncidentDto extends EmployeeAppIncidentDto {
  @ApiPropertyOptional({ description: 'Client involved (must be on the carer\'s round); omit for none' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;
}

export const VISIT_CARE_CONSENT_STATUSES = ['GRANTED', 'DECLINED'] as const;

export class EmployeeAppCareConsentDto {
  @ApiProperty({ enum: VISIT_CARE_CONSENT_STATUSES, example: 'GRANTED' })
  @IsIn(VISIT_CARE_CONSENT_STATUSES as unknown as string[])
  status!: (typeof VISIT_CARE_CONSENT_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Required when status is DECLINED',
    example: 'Person declined personal care this visit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deviceRecordedAt?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class EmployeeAppIdentityDto {
  @ApiProperty({ enum: ['confirmed', 'mismatch'] })
  @IsString()
  @MaxLength(16)
  result!: string;

  @ApiPropertyOptional({ enum: ['visual', 'nhs', 'photo'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class EmployeeAppHandoverAcknowledgeDto {
  @ApiProperty()
  @IsISO8601()
  acknowledgedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

/** Links a record (task, MAR, obs, incident, clock out …) to its carer voice notes. */
export class EmployeeAppVoiceNoteLinkDto {
  @ApiProperty({
    enum: [
      'incident',
      'task',
      'medication',
      'observation',
      'body_map',
      'body_map_review',
      'check_in',
      'clock_out',
      'unable_to_start',
      'check_in_request',
      'sos',
    ],
  })
  @IsString()
  @IsIn([
    'incident',
    'task',
    'medication',
    'observation',
    'body_map',
    'body_map_review',
    'check_in',
    'clock_out',
    'unable_to_start',
    'check_in_request',
    'sos',
  ])
  entryType!: string;

  @ApiProperty({ description: 'Carer-app id of the record (task key, incident clientEntryId, …)' })
  @IsString()
  @MaxLength(128)
  entryId!: string;

  @ApiPropertyOptional({
    description:
      'Idempotency key of the record save the voice notes belong to (matches its timeline event).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  writeIdempotencyKey?: string;

  @ApiProperty({ type: [String], description: 'clientVoiceNoteIds in recording order (max 3; empty clears)' })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  voiceNoteIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deviceRecordedAt?: string;
}
