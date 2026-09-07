import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export const ABSENCE_TYPES = [
  'Holiday',
  'Days Off',
  'Sickness',
  'Non-working Time',
  'Unauthorised',
  'Other',
] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_PERMISSION_STATUSES = ['Authorised', 'Unauthorised', 'Pending'] as const;
export type AbsencePermissionStatus = (typeof ABSENCE_PERMISSION_STATUSES)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class ListEmployeeAbsencesQueryDto {
  @ApiPropertyOptional({
    example: '2026-05',
    description: 'Calendar month (YYYY-MM) matched against the absence start. Omit for all.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ABSENCE_TYPES })
  @IsOptional()
  @IsIn(ABSENCE_TYPES)
  absenceType?: AbsenceType;

  @ApiPropertyOptional({ enum: ABSENCE_PERMISSION_STATUSES })
  @IsOptional()
  @IsIn(ABSENCE_PERMISSION_STATUSES)
  permissionStatus?: AbsencePermissionStatus;

  @ApiPropertyOptional({ description: 'Search employee name, record id, notes or CoS ref' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter absences to employees at this location' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Only UKVI sponsored workers' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  sponsoredOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only sickness-flagged records' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  sicknessOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only last-minute-flagged records' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  lastMinuteOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only records with an identified UKVI SMS trigger' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  smsTriggerOnly?: boolean;
}

class EmployeeAbsenceFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sicknessFlag?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  lastMinuteFlag?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  countryVisited?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackerStatus?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  returnToWorkCompleted?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  evidenceNotesStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  managerAction?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comments?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cosWorkerRef?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Date or e.g. "British Passport"' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  visaRtwExpiry?: string | null;

  @ApiPropertyOptional({ enum: ABSENCE_PERMISSION_STATUSES })
  @IsOptional()
  @IsIn(ABSENCE_PERMISSION_STATUSES)
  permissionStatus?: AbsencePermissionStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  evidenceTypeRequired?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  evidenceHeld?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  evidenceReceivedDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Manual override; null derives it from the absence span',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  continuousWorkingDaysAbsent?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'null = N/A' })
  @IsOptional()
  @IsBoolean()
  smsReported?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  smsReportDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsiblePerson?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  nextReviewDate?: string | null;
}

export class CreateEmployeeAbsenceDto extends EmployeeAbsenceFieldsDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: ABSENCE_TYPES })
  @IsIn(ABSENCE_TYPES)
  absenceType!: AbsenceType;

  @ApiProperty({ example: '2026-05-28T00:00:00.000Z' })
  @IsDateString()
  fromDateTime!: string;

  @ApiProperty({ example: '2026-05-28T23:55:00.000Z' })
  @IsDateString()
  toDateTime!: string;
}

export class UpdateEmployeeAbsenceDto extends EmployeeAbsenceFieldsDto {
  @ApiPropertyOptional({ enum: ABSENCE_TYPES })
  @IsOptional()
  @IsIn(ABSENCE_TYPES)
  absenceType?: AbsenceType;

  @ApiPropertyOptional({ example: '2026-05-28T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  fromDateTime?: string;

  @ApiPropertyOptional({ example: '2026-05-28T23:55:00.000Z' })
  @IsOptional()
  @IsDateString()
  toDateTime?: string;
}
