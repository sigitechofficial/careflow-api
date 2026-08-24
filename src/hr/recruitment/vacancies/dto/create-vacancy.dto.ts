import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecruitmentEmploymentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
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
