import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const VISIT_TASK_PRIORITY_CODES = ['routine', 'important', 'critical'] as const;
export type VisitTaskPriorityCode = (typeof VISIT_TASK_PRIORITY_CODES)[number];

export const VISIT_TASK_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type VisitTaskScheduleFrequency = (typeof VISIT_TASK_SCHEDULE_FREQUENCIES)[number];

export const VISIT_TASK_REPEAT_UNITS = ['DAYS', 'WEEKS', 'MONTHS'] as const;
export type VisitTaskRepeatUnit = (typeof VISIT_TASK_REPEAT_UNITS)[number];

export const VISIT_TASK_MONTHLY_DAY_MODES = ['BY_DATE', 'BY_PATTERN'] as const;
export type VisitTaskMonthlyDayMode = (typeof VISIT_TASK_MONTHLY_DAY_MODES)[number];

export const VISIT_TASK_MONTHLY_ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST'] as const;
export type VisitTaskMonthlyOrdinal = (typeof VISIT_TASK_MONTHLY_ORDINALS)[number];

export class ServiceUserVisitTaskScheduleDto {
  @ApiPropertyOptional({ enum: VISIT_TASK_SCHEDULE_FREQUENCIES, default: 'DAILY' })
  @IsOptional()
  @IsIn(VISIT_TASK_SCHEDULE_FREQUENCIES)
  scheduleFrequency?: VisitTaskScheduleFrequency;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  repeatEvery?: number;

  @ApiPropertyOptional({ enum: VISIT_TASK_REPEAT_UNITS })
  @IsOptional()
  @IsIn(VISIT_TASK_REPEAT_UNITS)
  repeatUnit?: VisitTaskRepeatUnit;

  @ApiPropertyOptional({ type: [Number], description: '0=Sun … 6=Sat' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  timeCritical?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 240, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  timeToleranceMinutes?: number;

  @ApiPropertyOptional({ enum: VISIT_TASK_MONTHLY_DAY_MODES })
  @IsOptional()
  @IsIn(VISIT_TASK_MONTHLY_DAY_MODES)
  monthlyDayMode?: VisitTaskMonthlyDayMode;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(31)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  monthlyDaysOfMonth?: number[];

  @ApiPropertyOptional({ enum: VISIT_TASK_MONTHLY_ORDINALS, nullable: true })
  @IsOptional()
  @IsIn([...VISIT_TASK_MONTHLY_ORDINALS])
  monthlyPatternOrdinal?: VisitTaskMonthlyOrdinal | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 6, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  monthlyPatternWeekday?: number | null;
}

export class ServiceUserVisitTaskItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  taskCatalogueTaskId!: string;

  @ApiPropertyOptional({ description: 'Instructions for the carer when completing this task' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  carerInstructions?: string | null;

  @ApiPropertyOptional({
    enum: VISIT_TASK_PRIORITY_CODES,
    default: 'routine',
    description: 'Relative priority for this task on the visit',
  })
  @IsOptional()
  @IsIn(VISIT_TASK_PRIORITY_CODES)
  priority?: VisitTaskPriorityCode;

  @ApiPropertyOptional({ type: ServiceUserVisitTaskScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceUserVisitTaskScheduleDto)
  schedule?: ServiceUserVisitTaskScheduleDto;
}

export class ServiceUserVisitTaskRoundDto {
  @ApiProperty({ example: 'MORNING' })
  @IsString()
  medicationRoundCode!: string;

  @ApiProperty({ type: [ServiceUserVisitTaskItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceUserVisitTaskItemDto)
  tasks!: ServiceUserVisitTaskItemDto[];
}

export class ReplaceServiceUserVisitTasksDto {
  @ApiProperty({ type: [ServiceUserVisitTaskRoundDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceUserVisitTaskRoundDto)
  rounds!: ServiceUserVisitTaskRoundDto[];
}
