import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { FundingStatus } from '../enums/funding-status.enum';

export class ServiceUserFundingQueryDto {
  @ApiPropertyOptional({ enum: FundingStatus })
  @IsOptional()
  @IsEnum(FundingStatus)
  status?: FundingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'startDate', 'endDate', 'status'] })
  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'updatedAt' | 'startDate' | 'endDate' | 'status' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
