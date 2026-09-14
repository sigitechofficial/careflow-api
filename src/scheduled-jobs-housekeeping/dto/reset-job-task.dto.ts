import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetJobTaskDto {
  @ApiProperty({ description: 'Why office is resetting this visit task' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;
}
