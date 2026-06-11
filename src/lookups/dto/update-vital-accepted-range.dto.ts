import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateVitalAcceptedRangeDto {
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  max?: number;
}
