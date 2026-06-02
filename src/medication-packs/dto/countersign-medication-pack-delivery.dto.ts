import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CountersignMedicationPackDeliveryDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Manager countersignature notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
