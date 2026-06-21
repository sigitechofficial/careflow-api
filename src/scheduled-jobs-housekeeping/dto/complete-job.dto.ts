import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ScheduledVisitStatus } from '../../scheduled-visits/enums/scheduled-visit-status.enum';

export class CompleteJobDto {
  @ApiPropertyOptional({
    enum: ScheduledVisitStatus,
    description: 'Visit outcome status (defaults to COMPLETED)',
  })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  @ApiPropertyOptional({ description: 'Completion notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Care pathway form IDs delivered during this visit' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deliveredCarePlanFormIds?: string[];

  @ApiPropertyOptional({ description: 'Actual visit start time (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  actualStartDateTime?: string;

  @ApiPropertyOptional({
    description: 'Actual visit end time (ISO 8601); defaults to now when completing without an end time',
  })
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;
}
