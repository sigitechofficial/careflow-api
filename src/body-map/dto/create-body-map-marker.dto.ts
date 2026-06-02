import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BodyMapBodyView, BodyMapRecordType, BodyMapRiskLevel, BodyMapSide } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateBodyMapMarkerDto {
  @ApiProperty({ enum: BodyMapBodyView })
  @IsEnum(BodyMapBodyView)
  bodyView!: BodyMapBodyView;

  @ApiPropertyOptional({ enum: BodyMapSide })
  @IsOptional()
  @IsEnum(BodyMapSide)
  side?: BodyMapSide;

  @ApiProperty({ example: 'Left shoulder' })
  @IsString()
  @MaxLength(120)
  bodyPart!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specificLocation?: string;

  @ApiProperty({ description: 'X position as percentage 0–100' })
  @IsNumber()
  @Min(0)
  @Max(100)
  xCoordinate!: number;

  @ApiProperty({ description: 'Y position as percentage 0–100' })
  @IsNumber()
  @Min(0)
  @Max(100)
  yCoordinate!: number;

  @ApiPropertyOptional({ enum: BodyMapRecordType })
  @IsOptional()
  @IsEnum(BodyMapRecordType)
  markerType?: BodyMapRecordType;

  @ApiPropertyOptional({ enum: BodyMapRiskLevel })
  @IsOptional()
  @IsEnum(BodyMapRiskLevel)
  riskLevel?: BodyMapRiskLevel;
}
