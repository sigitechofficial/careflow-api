import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMedicationSupportProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  selfAdministersMedication?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresPrompting?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresSupervision?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresCarerAdministration?: boolean;

  @ApiPropertyOptional({
    description:
      'Family member or carer gives medicines support (CQC / NICE NG67).',
  })
  @IsOptional()
  @IsBoolean()
  familyMemberOrCarerSupportsMedication?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
