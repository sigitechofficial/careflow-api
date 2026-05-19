import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelJobDto {
  @ApiPropertyOptional({ description: 'Cancellation reason / notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
