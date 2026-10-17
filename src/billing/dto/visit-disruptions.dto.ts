import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DISRUPTION_EVENTS, DISRUPTION_OUTCOMES } from '../visit-disruption.util';

export class CreateDisruptionRuleDto {
  @ApiProperty({ enum: DISRUPTION_EVENTS })
  @IsIn(DISRUPTION_EVENTS as unknown as string[])
  eventType!: string;

  @ApiPropertyOptional({ description: 'Applies when the notice given was shorter than this many minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 60)
  noticeBelowMinutes?: number | null;

  @ApiProperty({ enum: DISRUPTION_OUTCOMES })
  @IsIn(DISRUPTION_OUTCOMES as unknown as string[])
  outcome!: string;

  @ApiPropertyOptional({ description: 'For PERCENT_OF_SCHEDULED' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(300)
  percent?: number | null;

  @ApiPropertyOptional({ description: 'For FIXED_AMOUNT' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  fixedAmount?: number | null;

  @ApiProperty({ example: '2026-11-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ description: 'A rule entered to test the calculation; never the employer policy' })
  @IsOptional()
  @IsBoolean()
  isSynthetic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordDisruptionDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ description: 'The scheduled visit the event is about' })
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;

  @ApiPropertyOptional({ description: 'The visit reconciliation, when the visit took place in part' })
  @IsOptional()
  @IsUUID()
  visitReconciliationId?: string;

  @ApiProperty({ enum: DISRUPTION_EVENTS })
  @IsIn(DISRUPTION_EVENTS as unknown as string[])
  eventType!: string;

  @ApiProperty({ description: 'When the visit was due, or when the event happened' })
  @IsDateString()
  eventAt!: string;

  @ApiPropertyOptional({ description: 'Minutes of notice the carer had' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 60)
  noticeMinutes?: number | null;

  @ApiPropertyOptional({ description: 'Scheduled length of the visit in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  scheduledMinutes?: number | null;

  @ApiPropertyOptional({ description: 'Minutes waited, or minutes the visit was cut short by' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  affectedMinutes?: number | null;

  @ApiProperty({ description: 'What happened' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class DecideDisruptionDto {
  @ApiProperty({ description: 'What is to be paid for the event. Zero is a decision and needs its reason.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  amount!: number;

  @ApiProperty({ description: 'Why this amount' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
}

export class DisruptionNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;
}

export class DisruptionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
