import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class MedicationPackAdminRulesDto {
  @ApiProperty()
  @IsBoolean()
  mcaCapacity!: boolean;

  @ApiProperty()
  @IsBoolean()
  mcaBestInterests!: boolean;

  @ApiProperty()
  @IsBoolean()
  mcaPrescriberList!: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  witnessRound?: string;

  @ApiPropertyOptional({ enum: ['no', 'yes'] })
  @IsOptional()
  @IsIn(['no', 'yes'])
  covert?: string;

  @ApiPropertyOptional({ enum: ['no', 'yes'] })
  @IsOptional()
  @IsIn(['no', 'yes'])
  prnOverride?: string;

  @ApiPropertyOptional({ enum: ['yes', 'no'] })
  @IsOptional()
  @IsIn(['yes', 'no'])
  lateAllowed?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  lateHours?: number;

  @ApiPropertyOptional({ enum: ['exceptions', 'always'] })
  @IsOptional()
  @IsIn(['exceptions', 'always'])
  reviewMode?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  riskNotes?: string;
}
