import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ManualAttendanceDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(['CHECK_IN', 'CHECK_OUT'])
  eventType!: 'CHECK_IN' | 'CHECK_OUT';

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @MaxLength(80)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  overrideGeofence?: boolean;

  @IsOptional()
  @IsUUID()
  originalEventId?: string;
}

export class MissedTriageDto {
  @IsIn([
    'CONFIRMED_MISSED',
    'FALSE_ECM_ALERT',
    'DISPUTED',
    'ATTENDANCE_VERIFICATION_PENDING',
    'POTENTIAL_MISSED',
  ])
  outcome!:
    | 'CONFIRMED_MISSED'
    | 'FALSE_ECM_ALERT'
    | 'DISPUTED'
    | 'ATTENDANCE_VERIFICATION_PENDING'
    | 'POTENTIAL_MISSED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateNotificationEvidenceDto {
  @IsOptional()
  @IsUUID()
  ecmExceptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contactRole?: string;

  @IsIn(['PHONE', 'SMS', 'EMAIL', 'IN_APP', 'IN_PERSON', 'OTHER'])
  method!: string;

  @IsOptional()
  @IsIn([
    'ATTEMPTED',
    'ANSWERED',
    'DELIVERED',
    'READ',
    'NO_ANSWER',
    'FAILED',
    'ACCEPTED',
    'DECLINED',
  ])
  outcome?: string;

  @IsOptional()
  @IsISO8601()
  attemptedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  etaGiven?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonGiven?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  replacementDetails?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  acceptedDeclined?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
