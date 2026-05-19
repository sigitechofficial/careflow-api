import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AllocationStatus } from '../enums/allocation-status.enum';

export class AllocationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledVisitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: AllocationStatus })
  @IsOptional()
  @IsEnum(AllocationStatus)
  status?: AllocationStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}
