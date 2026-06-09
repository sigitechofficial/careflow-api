import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanRepeatUnit,
  VisitPlanScheduleFrequency,
  VisitPlanSlotCode,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class VisitPlanSlotDto {
  @ApiProperty({ enum: VisitPlanSlotCode })
  @IsEnum(VisitPlanSlotCode)
  slotCode!: VisitPlanSlotCode;

  @ApiProperty({ type: [Number], description: '0=Sun … 6=Sat' })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ example: '07:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedStartTime!: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedEndTime!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  requiredCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  medicationRoundCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: VisitPlanScheduleFrequency })
  @IsOptional()
  @IsEnum(VisitPlanScheduleFrequency)
  scheduleFrequency?: VisitPlanScheduleFrequency;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  repeatEvery?: number;

  @ApiPropertyOptional({ enum: VisitPlanRepeatUnit })
  @IsOptional()
  @IsEnum(VisitPlanRepeatUnit)
  repeatUnit?: VisitPlanRepeatUnit;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  timeCritical?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  timeToleranceMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 480 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  durationMinutes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notesRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  photoAllowed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shareOutcomeWithFamily?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  analysisArea?: string | null;

  @ApiPropertyOptional({ enum: VisitPlanMonthlyDayMode })
  @IsOptional()
  @IsEnum(VisitPlanMonthlyDayMode)
  monthlyDayMode?: VisitPlanMonthlyDayMode;

  @ApiPropertyOptional({ type: [Number], description: 'Days 1–31 of month' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  monthlyDaysOfMonth?: number[];

  @ApiPropertyOptional({ enum: VisitPlanMonthlyOrdinal })
  @IsOptional()
  @IsEnum(VisitPlanMonthlyOrdinal)
  monthlyPatternOrdinal?: VisitPlanMonthlyOrdinal | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 6, description: '0=Sun … 6=Sat' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  monthlyPatternWeekday?: number | null;

  @ApiPropertyOptional({ type: [String], description: 'Accepted care pathway form ids delivered on this call' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  linkedCarePlanFormIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Assigned carer employee ids for this call slot' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  assignedEmployeeIds?: string[];
}
