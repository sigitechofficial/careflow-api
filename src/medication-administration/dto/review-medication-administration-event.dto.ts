import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewMedicationAdministrationEventDto {
  @ApiPropertyOptional({ description: 'Optional manager review notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
