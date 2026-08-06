import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateEcmThresholdLookupDto {
  @ApiProperty({ example: 15, description: 'Non-negative integer threshold value' })
  @IsInt()
  @Min(0)
  valueInt!: number;
}
