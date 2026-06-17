import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderRunJobsDto {
  @ApiProperty({
    description: 'Scheduled job IDs in the desired run order',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  visitIds!: string[];
}
