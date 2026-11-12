import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecruitmentEmploymentType, SalaryPeriod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

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
}
