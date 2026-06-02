import { ApiPropertyOptional } from '@nestjs/swagger';
import { BodyMapBodyView, BodyMapRecordStatus, BodyMapRiskLevel, BodyMapSide } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateBodyMapMarkerDto {
  @ApiPropertyOptional({ enum: BodyMapBodyView })
  @IsOptional()
  @IsEnum(BodyMapBodyView)
  bodyView?: BodyMapBodyView;

  @ApiPropertyOptional({ enum: BodyMapSide })
  @IsOptional()
  @IsEnum(BodyMapSide)
  side?: BodyMapSide;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bodyPart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specificLocation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  xCoordinate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  yCoordinate?: number;

  @ApiPropertyOptional({ enum: BodyMapRiskLevel })
  @IsOptional()
  @IsEnum(BodyMapRiskLevel)
  riskLevel?: BodyMapRiskLevel;

  @ApiPropertyOptional({ enum: BodyMapRecordStatus })
  @IsOptional()
  @IsEnum(BodyMapRecordStatus)
  status?: BodyMapRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}
