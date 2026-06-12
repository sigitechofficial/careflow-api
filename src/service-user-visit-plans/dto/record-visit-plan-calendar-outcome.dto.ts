import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ScheduledVisitStatus } from '../../scheduled-visits/enums/scheduled-visit-status.enum';

export class RecordVisitPlanCalendarOutcomeDto {
  @ApiProperty()
  @IsUUID()
  visitPlanSlotId!: string;

  @ApiProperty({ example: '2026-06-08' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ enum: ScheduledVisitStatus })
  @IsEnum(ScheduledVisitStatus)
  status!: ScheduledVisitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  /** Carer who attended the visit (allocated on the job if not already). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Actual visit start time on the visit date (HH:mm, UTC). */
  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  actualStartTime?: string;

  /** Actual visit end time on the visit date (HH:mm, UTC). */
  @ApiPropertyOptional({ example: '09:45' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  actualEndTime?: string;
}
