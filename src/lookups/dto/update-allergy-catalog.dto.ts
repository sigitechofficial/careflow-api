import { PartialType } from '@nestjs/swagger';
import { CreateAllergyCatalogDto } from './create-allergy-catalog.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAllergyCatalogDto extends PartialType(CreateAllergyCatalogDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
