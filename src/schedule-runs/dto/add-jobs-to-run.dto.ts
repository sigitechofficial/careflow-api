import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AddJobsToRunDto {
  @ApiProperty({
    description: 'Scheduled job IDs (single visits) to add to the run',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  visitIds!: string[];
}
