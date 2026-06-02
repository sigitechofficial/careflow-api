import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class PublishMedicationPackDto {
  @ApiPropertyOptional({ description: 'Confirm contents have been checked against the MAR/MCA' })
  @IsOptional()
  @IsBoolean()
  confirmAccurate?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
