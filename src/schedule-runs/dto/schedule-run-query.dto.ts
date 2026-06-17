import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleRunStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ScheduleRunQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ScheduleRunStatus })
  @IsOptional()
  @IsEnum(ScheduleRunStatus)
  status?: ScheduleRunStatus;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  runDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  runDateFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  runDateTo?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeJobs?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: ['sortOrder', 'name', 'runDate', 'createdAt'] })
  @IsOptional()
  @IsString()
  sortBy?: 'sortOrder' | 'name' | 'runDate' | 'createdAt' = 'sortOrder';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}
