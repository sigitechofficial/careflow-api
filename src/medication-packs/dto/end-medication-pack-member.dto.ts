import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EndMedicationPackMemberDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Reason the medication was removed mid-cycle' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
