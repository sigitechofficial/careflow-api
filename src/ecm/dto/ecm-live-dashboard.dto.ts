import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  EcmArrivalClassification,
  EcmLifecycleStatus,
  EcmMissedClassification,
} from '@prisma/client';

export class EcmLiveDashboardQueryDto {
  @ApiPropertyOptional({ description: 'ISO date YYYY-MM-DD (local operational day)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Branch / schedule area id' })
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ enum: EcmArrivalClassification })
  @IsOptional()
  @IsEnum(EcmArrivalClassification)
  arrivalClassification?: EcmArrivalClassification;

  @ApiPropertyOptional({ enum: EcmMissedClassification })
  @IsOptional()
  @IsEnum(EcmMissedClassification)
  missedClassification?: EcmMissedClassification;

  @ApiPropertyOptional({ enum: EcmLifecycleStatus })
  @IsOptional()
  @IsEnum(EcmLifecycleStatus)
  lifecycleStatus?: EcmLifecycleStatus;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  limit?: number;

  @ApiPropertyOptional({ description: 'Free-text search on job name / SU name' })
  @IsOptional()
  @IsString()
  search?: string;
}
