import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SupersedeMedicationPackDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Name for the new (next-cycle) pack. Defaults to the current name.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  newPackName?: string;

  @ApiPropertyOptional({ description: 'Carry the current ACTIVE members into the new pack as DRAFT', default: true })
  @IsOptional()
  @IsBoolean()
  carryMembers?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
