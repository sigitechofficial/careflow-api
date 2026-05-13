import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ServiceUserReferenceItemDto {
  @ApiPropertyOptional({ description: 'Existing reference id for update' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'NHS_NUMBER' })
  @IsString()
  @MaxLength(100)
  referenceType!: string;

  /** Long text / JSON (e.g. About Me `SU_ABOUT_ME_V1`). DB column is TEXT. */
  @ApiProperty({ example: '1234567890' })
  @IsString()
  @MaxLength(100000)
  referenceValue!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
