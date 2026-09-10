import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EMERGENCY_PROTOCOL_ICON_KEYS } from '../emergency-protocols.defaults';

export class EmergencyProtocolStepDto {
  @ApiProperty({ example: 'Call 999' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  action!: string;

  @ApiPropertyOptional({ example: 'Stay on the line and follow the call handler.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;
}

export class CreateEmergencyProtocolDto {
  @ApiProperty({ example: 'hypo' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Hypoglycaemia' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ example: 'Blood glucose <4' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'v1.4' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;

  @ApiPropertyOptional({ enum: EMERGENCY_PROTOCOL_ICON_KEYS, default: 'alert' })
  @IsOptional()
  @IsIn(EMERGENCY_PROTOCOL_ICON_KEYS as unknown as string[])
  iconKey?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ type: [EmergencyProtocolStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EmergencyProtocolStepDto)
  steps!: EmergencyProtocolStepDto[];
}
