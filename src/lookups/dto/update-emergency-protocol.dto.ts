import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EMERGENCY_PROTOCOL_ICON_KEYS } from '../emergency-protocols.defaults';
import { EmergencyProtocolStepDto } from './create-emergency-protocol.dto';

export class UpdateEmergencyProtocolDto {
  @ApiPropertyOptional({ example: 'hypo' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({ example: 'Hypoglycaemia' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;

  @ApiPropertyOptional({ enum: EMERGENCY_PROTOCOL_ICON_KEYS })
  @IsOptional()
  @IsIn(EMERGENCY_PROTOCOL_ICON_KEYS as unknown as string[])
  iconKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [EmergencyProtocolStepDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EmergencyProtocolStepDto)
  steps?: EmergencyProtocolStepDto[];
}
