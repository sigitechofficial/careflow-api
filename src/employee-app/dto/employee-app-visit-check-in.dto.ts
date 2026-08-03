import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class EmployeeAppVisitCheckInDto {
  @ApiPropertyOptional({ description: 'Client event id for offline idempotency (alias)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientEventId?: string;

  @ApiPropertyOptional({ description: 'Idempotency key (contract)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({ example: '2026-07-16T07:40:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deviceCapturedAt?: string;

  @ApiPropertyOptional({ example: '2026-07-16T07:40:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deviceRecordedAt?: string;

  @ApiPropertyOptional({ example: '2026-07-16T07:40:00.000Z' })
  @IsOptional()
  @IsISO8601()
  locationCapturedAt?: string;

  @ApiPropertyOptional({ example: 51.5074 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: -0.1278 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockLocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockedLocation?: boolean;

  @ApiPropertyOptional({ description: 'Carer confirmed client identity at check-in' })
  @IsOptional()
  @IsBoolean()
  identityConfirmed?: boolean;

  @ApiPropertyOptional({ enum: ['GPS', 'NFC', 'QR', 'MANUAL'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withinArea?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  distanceMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  timingStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timingExceptionReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  timingExceptionNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  manualOverrideReasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  manualOverrideNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  welfareOutcomeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  personSeen?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  accessViaKeySafe?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManagerReview?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  outsideGeofenceReason?: string;
}
