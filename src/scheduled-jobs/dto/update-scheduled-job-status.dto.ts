import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ScheduledJobStatus } from '../enums/scheduled-job-status.enum';

export class UpdateScheduledJobStatusDto {
  @ApiProperty({ enum: ScheduledJobStatus })
  @IsEnum(ScheduledJobStatus)
  status!: ScheduledJobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
