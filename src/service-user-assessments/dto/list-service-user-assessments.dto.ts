import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListServiceUserAssessmentsDto {
  @ApiPropertyOptional({
    description: 'Optional flag to include full completion history in future phases.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeHistory?: boolean;
}
