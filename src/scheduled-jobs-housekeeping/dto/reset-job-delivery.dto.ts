import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetJobDeliveryDto {
  @ApiProperty({ description: 'Why office is wiping this visit back to planned' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;
}
