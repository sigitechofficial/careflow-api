import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecruitmentEmploymentType, SalaryPeriod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CV_REQUIREMENTS,
  HOURS_TYPES,
  MAX_QUESTIONS,
  NOTIFY_MODES,
  SHIFTS,
  WORK_SETTINGS,
} from '../../utils/vacancy-screening.util';

export class CreateVacancyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ enum: RecruitmentEmploymentType })
  @IsEnum(RecruitmentEmploymentType)
  employmentType!: RecruitmentEmploymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  salaryRange?: string;

  @ApiPropertyOptional({ enum: SalaryPeriod, nullable: true, description: 'What the salary is per (hour, month, year…)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(SalaryPeriod)
  salaryPeriod?: SalaryPeriod | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-30', description: 'Last day to apply (inclusive)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  closingDate?: Date | null;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numberOfPositions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  hiringManagerId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN'], description: 'Save as a draft (not on the careers page) or publish' })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN'])
  status?: 'DRAFT' | 'OPEN';

  @ApiPropertyOptional({ enum: WORK_SETTINGS, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn([...WORK_SETTINGS])
  workSetting?: string | null;

  @ApiPropertyOptional({ enum: HOURS_TYPES, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn([...HOURS_TYPES])
  hoursType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  hoursPerWeekMin?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  hoursPerWeekMax?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-01', description: 'First day of work; empty = as soon as possible' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  startDate?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  payMin?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  payMax?: number | null;

  @ApiPropertyOptional({ enum: SHIFTS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn([...SHIFTS], { each: true })
  shifts?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  benefits?: string[];

  @ApiPropertyOptional({ description: 'Questions asked when applying (see vacancy-screening.util)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  screeningQuestions?: unknown[];

  @ApiPropertyOptional({ enum: CV_REQUIREMENTS })
  @IsOptional()
  @IsIn([...CV_REQUIREMENTS])
  cvRequirement?: string;

  @ApiPropertyOptional({ enum: NOTIFY_MODES })
  @IsOptional()
  @IsIn([...NOTIFY_MODES])
  notifyMode?: string;
}
