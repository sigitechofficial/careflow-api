import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength, IsOptional } from 'class-validator';

export class VisitPlanStatusChangeDto {
  @ApiProperty({ description: 'Reason for suspend/end (CQC audit)' })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'When true (default), cancel future scheduled visits for this service user',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  cancelFutureVisits?: boolean;
}
