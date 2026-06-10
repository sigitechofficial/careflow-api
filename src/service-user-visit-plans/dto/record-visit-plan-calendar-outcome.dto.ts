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
}
