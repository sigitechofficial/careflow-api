import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateCarePlanAssessmentLinkDto {
  @ApiProperty({ description: 'Assessment completion to attach to the care plan form.' })
  @IsUUID()
  completionId!: string;
}
