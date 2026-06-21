import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class VisitPlanStatusChangeDto {
  @ApiProperty({ description: 'Reason for end (CQC audit)' })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Last day visits should run (YYYY-MM-DD). Future date schedules closure; past date ends retrospectively. Defaults to today.',
  })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional({
    description: 'Required when effectiveTo is before today — why the record is being corrected retrospectively',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  retrospectiveReason?: string;

  @ApiPropertyOptional({
    description: 'When true (default), cancel scheduled visits from the effective end date forward',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  cancelFutureVisits?: boolean;
}
