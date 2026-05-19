import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class WellbeingScoreDto {
  @ApiProperty({ example: 'MOBILITY' })
  @IsString()
  dimensionCode!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  level!: number;
}
