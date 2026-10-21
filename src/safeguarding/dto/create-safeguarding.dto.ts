import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  SafeguardingCategory,
  SafeguardingReferralDecision,
  SafeguardingRisk,
} from '@prisma/client';

export const SAFE_OPTIONS = ['YES', 'NO', 'NOT_KNOWN'];
export const CAPACITY_OPTIONS = ['YES', 'NO', 'FLUCTUATING', 'NOT_ASSESSED'];
export const MEETING_OPTIONS = ['YES', 'NO', 'PLANNED'];

export class CreateSafeguardingDto {
  @ApiProperty({ enum: SafeguardingCategory })
  @IsEnum(SafeguardingCategory)
  category!: SafeguardingCategory;

  @ApiPropertyOptional({ enum: SafeguardingRisk, default: 'MEDIUM' })
  @IsOptional()
  @IsEnum(SafeguardingRisk)
  riskLevel?: SafeguardingRisk;

  @ApiPropertyOptional({ format: 'uuid', description: 'Service user the concern is about (optional).' })
  @IsOptional()
  @IsUUID()
  aboutServiceUserId?: string;

  @ApiPropertyOptional({ description: 'Free-text person description when not a service user.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  personDescription?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Allocated safeguarding lead (employee).' })
  @IsOptional()
  @IsUUID()
  handlerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  raisedByRole?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  raisedAt?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  immediateAction?: string;

  @ApiPropertyOptional({ enum: SafeguardingReferralDecision })
  @IsOptional()
  @IsEnum(SafeguardingReferralDecision)
  laReferral?: SafeguardingReferralDecision;

  @ApiPropertyOptional({ enum: SafeguardingReferralDecision })
  @IsOptional()
  @IsEnum(SafeguardingReferralDecision)
  cqcNotified?: SafeguardingReferralDecision;

  @ApiPropertyOptional({ format: 'uuid', description: 'Case lead (office user).' })
  @IsOptional()
  @IsUUID()
  leadUserId?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  reviewDate?: string | null;

  /* ─── Immediate safety ─── */

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  reportedToManagerAt?: string | null;

  @ApiPropertyOptional({ enum: SAFE_OPTIONS })
  @IsOptional()
  @IsIn(SAFE_OPTIONS)
  personSafe?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  safetyMeasures?: string | null;

  /* ─── Voice of the person ─── */

  @ApiPropertyOptional({ description: 'What the person said, in their own words.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  personWords?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  evidence?: string | null;

  @ApiPropertyOptional({ description: 'What the person wants to happen.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  personWants?: string | null;

  @ApiPropertyOptional({ enum: CAPACITY_OPTIONS })
  @IsOptional()
  @IsIn(CAPACITY_OPTIONS)
  capacity?: string | null;

  /* ─── Multi-agency ─── */

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  agencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  agenciesOther?: string | null;

  @ApiPropertyOptional({ enum: MEETING_OPTIONS })
  @IsOptional()
  @IsIn(MEETING_OPTIONS)
  meetingHeld?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  meetingDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  protectionPlan?: string | null;
}
