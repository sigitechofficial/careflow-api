import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
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
  @MaxLength(5)
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

export class EmployeeAppIncidentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  incidentType!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  severity?: string;

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

  @ApiPropertyOptional({ type: EmployeeAppIncidentBodyMapDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeAppIncidentBodyMapDto)
  bodyMap?: EmployeeAppIncidentBodyMapDto;

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
