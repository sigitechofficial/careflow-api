import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  QualityAuditActionStatus,
  QualityAuditAnswerValue,
  QualityAuditStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  AUDIT_FREQUENCIES,
  COMPLIANCE_LEVELS,
  type AuditFrequency,
  type ComplianceLevel,
} from '../quality-audit-schedule.util';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === undefined || (typeof value === 'string' && value.trim() === '')
    ? undefined
    : value;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TEMPLATE_CODE = /^(AUD|OWN)-\d{3,4}$/;
const KEY_QUESTIONS = [
  'SAFE',
  'EFFECTIVE',
  'CARING',
  'RESPONSIVE',
  'WELL_LED',
] as const;

/** The dashboard tabs. */
export const AUDIT_TABS = [
  'OVERDUE',
  'DUE',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
] as const;
export type AuditTab = (typeof AUDIT_TABS)[number];

/** Filters shared by the list, the dashboard and the reports. */
export class AuditFiltersDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Audits of this branch (plus whole-organisation ones)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'INFECTION_PREVENTION' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(60)
  areaCode?: string;

  @ApiPropertyOptional({ description: 'The person accountable (user id)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  accountableUserId?: string;
}

export class ListQualityAuditsQueryDto extends AuditFiltersDto {
  @ApiPropertyOptional({ enum: AUDIT_TABS })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(AUDIT_TABS)
  tab?: AuditTab;

  @ApiPropertyOptional({ enum: QualityAuditStatus })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(QualityAuditStatus)
  status?: QualityAuditStatus;

  @ApiPropertyOptional({ example: 'AUD-001' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(TEMPLATE_CODE)
  templateCode?: string;

  @ApiPropertyOptional({
    enum: COMPLIANCE_LEVELS,
    description: 'Completed audits at this level',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(COMPLIANCE_LEVELS)
  level?: ComplianceLevel;

  @ApiPropertyOptional({ description: 'Words in the audit title' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AuditReportsQueryDto extends AuditFiltersDto {
  @ApiPropertyOptional({
    description: 'Look back this many days (default 30)',
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  days?: number;
}

export class StartQualityAuditDto {
  @ApiProperty({ example: 'AUD-001' })
  @Matches(TEMPLATE_CODE, { message: 'Choose an audit from the library' })
  templateCode!: string;

  @ApiPropertyOptional({
    description: 'Branch audited; empty = the whole organisation',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    example: '2026-11-23',
    description: 'Defaults to today',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(DATE_ONLY, { message: 'auditDate must be YYYY-MM-DD' })
  auditDate?: string;

  @ApiPropertyOptional({
    description: 'User carrying out the audit; defaults to you',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  auditorId?: string;

  @ApiPropertyOptional({ description: 'Defaults to "<audit>, <month year>"' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: "What was audited, under the template's label",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  auditedItemValue?: string;
}

export class BeginQualityAuditDto {
  @ApiPropertyOptional({
    description: "What was audited, under the template's label",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  auditedItemValue?: string;
}

export class UpdateQualityAuditDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: '2026-11-23' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'auditDate must be YYYY-MM-DD' })
  auditDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  auditorId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  accountableUserId?: string | null;

  @ApiPropertyOptional({ description: "The auditor's overall comments" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiPropertyOptional({ description: 'What was audited' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  auditedItemValue?: string;
}

export class AnswerStandardDto {
  @ApiProperty({
    enum: QualityAuditAnswerValue,
    nullable: true,
    description: 'null clears the answer',
  })
  @ValidateIf((_, v) => v !== null)
  @IsEnum(QualityAuditAnswerValue)
  answer!: QualityAuditAnswerValue | null;

  @ApiPropertyOptional({
    description:
      'What was found; needed for a standard not met before the audit can be completed',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description: 'Met so well it is worth sharing (met standards only)',
  })
  @IsOptional()
  @IsBoolean()
  celebrate?: boolean;
}

export class CreateQualityAuditActionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detail?: string;

  @ApiPropertyOptional({
    description: 'The standard (its id in the audit) the action is for',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  standardId?: string;

  @ApiPropertyOptional({
    description: 'Staff member (employee id) who should do it',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  assignedEmployeeId?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  urgent?: boolean;
}

export class UpdateQualityAuditActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detail?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedEmployeeId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @ApiPropertyOptional({ enum: QualityAuditActionStatus })
  @IsOptional()
  @IsEnum(QualityAuditActionStatus)
  status?: QualityAuditActionStatus;
}

// ─── Areas and templates ────────────────────────────────────────────────────

export class CreateAuditAreaDto {
  @ApiProperty({ example: 'Medication' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class ListAuditTemplatesQueryDto {
  @ApiPropertyOptional({ example: 'INFECTION_PREVENTION' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(60)
  areaCode?: string;

  @ApiPropertyOptional({ enum: ['library', 'custom'] })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['library', 'custom'])
  kind?: 'library' | 'custom';
}

export class AuditStandardInputDto {
  @ApiPropertyOptional({
    description: 'Keep the id of an existing standard when editing',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(80)
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  text!: string;

  @ApiPropertyOptional({ description: 'How to check it' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(500)
  hint?: string;
}

export class AuditSectionInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @ApiProperty({ type: [AuditStandardInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Every section needs at least one standard' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AuditStandardInputDto)
  standards!: AuditStandardInputDto[];
}

export class SaveAuditTemplateDto {
  @ApiProperty({ example: 'INFECTION_PREVENTION' })
  @IsString()
  @MaxLength(60)
  areaCode!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Shown at the top of the audit' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  introduction?: string;

  @ApiProperty({ enum: AUDIT_FREQUENCIES })
  @IsIn(AUDIT_FREQUENCIES)
  frequency!: AuditFrequency;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  earlyDays?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateDays?: number;

  @ApiPropertyOptional({
    description:
      'Record what was audited under this label (e.g. "Person supported"); empty = not used',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  auditedItemLabel?: string;

  @ApiPropertyOptional({ enum: KEY_QUESTIONS })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(KEY_QUESTIONS)
  keyQuestionCode?: (typeof KEY_QUESTIONS)[number];

  @ApiPropertyOptional({
    type: [String],
    description: 'Branches that use it; empty = every branch',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiProperty({ type: [AuditSectionInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one section of standards' })
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AuditSectionInputDto)
  sections!: AuditSectionInputDto[];
}

// ─── Schedules ──────────────────────────────────────────────────────────────

export class ListAuditSchedulesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'AUD-001' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(TEMPLATE_CODE)
  templateCode?: string;

  @ApiPropertyOptional({ description: 'Include stopped schedules' })
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    return v === true || v === 'true' || v === '1';
  })
  @IsBoolean()
  includeStopped?: boolean;
}

export class CreateAuditScheduleDto {
  @ApiProperty({ example: 'AUD-001' })
  @Matches(TEMPLATE_CODE, { message: 'Choose an audit' })
  templateCode!: string;

  @ApiPropertyOptional({
    description: 'Branch; empty = the whole organisation',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    enum: AUDIT_FREQUENCIES,
    description: "Defaults to the template's",
  })
  @IsOptional()
  @IsIn(AUDIT_FREQUENCIES)
  frequency?: AuditFrequency;

  @ApiPropertyOptional({ description: "Defaults to the template's" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  earlyDays?: number;

  @ApiPropertyOptional({ description: "Defaults to the template's" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateDays?: number;

  @ApiProperty({ example: '2026-12-01', description: 'The first due date' })
  @Matches(DATE_ONLY, { message: 'firstDueDate must be YYYY-MM-DD' })
  firstDueDate!: string;

  @ApiPropertyOptional({
    description: 'The person accountable (user); defaults to you',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  accountableUserId?: string;
}

export class UpdateAuditScheduleDto {
  @ApiPropertyOptional({ enum: AUDIT_FREQUENCIES })
  @IsOptional()
  @IsIn(AUDIT_FREQUENCIES)
  frequency?: AuditFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  earlyDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateDays?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  accountableUserId?: string | null;
}
