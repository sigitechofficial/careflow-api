import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EndMedicationPackDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Reason the pack was ended (e.g. service ended, hospital admission)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
