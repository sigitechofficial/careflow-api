import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class VisitPlanStatusChangeDto {
  @ApiProperty({ description: 'Reason for suspend/end (CQC audit)' })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
