import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ObservationQueryDto {
  @ApiPropertyOptional({ example: 'RESPIRATION', description: 'Filter history by observation type code.' })
  @IsOptional()
  @IsString()
  typeCode?: string;
}
