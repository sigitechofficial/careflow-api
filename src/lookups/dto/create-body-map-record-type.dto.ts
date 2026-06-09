import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateBodyMapRecordTypeDto {
  @ApiProperty({ example: 'Bruise' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'bruise' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ description: 'Omit for a top-level record type' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Include in initial assessment wound type options' })
  @IsOptional()
  @IsBoolean()
  initialAssessmentWoundType?: boolean;

  @ApiPropertyOptional({ example: '#dc2626', description: 'Body map pin colour (hex)' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  markerColorHex?: string;
}
