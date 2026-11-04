import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class UpdateCarePlanRequiredAssessmentsDto {
  @ApiProperty({
    type: [String],
    description:
      'Assessment form IDs required for this care plan (replaces the current list; [] clears it)',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  assessmentFormIds!: string[];
}
