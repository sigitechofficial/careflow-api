import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ScheduledVisitStatus } from '../enums/scheduled-visit-status.enum';

export class UpdateScheduledVisitStatusDto {
  @ApiProperty({ enum: ScheduledVisitStatus })
  @IsEnum(ScheduledVisitStatus)
  status!: ScheduledVisitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
