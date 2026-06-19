import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReinstateJobDto {
  @ApiPropertyOptional({ description: 'Why the visit is being put back on the rota' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
