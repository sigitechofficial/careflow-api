import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateMemberLocationDto {
  @ApiPropertyOptional({ nullable: true, description: 'Branch Location id' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Service user area under a branch' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  serviceUserAreaId?: string | null;
}
