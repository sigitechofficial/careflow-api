import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreatePathwayChecklistItemDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  itemText!: string;

  @ApiPropertyOptional()
  @IsOptional()
  sortOrder?: number;
}

export class CreatePathwayChecklistDto {
  @ApiProperty({ maxLength: 45 })
  @IsString()
  @MaxLength(45)
  name!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  analysisGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  observationEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordPhoto?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  familyShare?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  groupAction?: boolean;

  @ApiPropertyOptional({ type: [CreatePathwayChecklistItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePathwayChecklistItemDto)
  items?: CreatePathwayChecklistItemDto[];
}
