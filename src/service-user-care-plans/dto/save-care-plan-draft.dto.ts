import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveCarePlanDraftDto {
  @ApiProperty({ description: 'Form Builder field values keyed by field id.' })
  @IsObject()
  values!: Record<string, string | boolean>;

  @ApiPropertyOptional({ description: 'Optional compose metadata (Phase 1+).' })
  @IsOptional()
  @IsObject()
  composedFrom?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Optional gap list (Phase 1+).' })
  @IsOptional()
  gaps?: unknown[];
}

export class PublishCarePlanDto {
  @ApiPropertyOptional({ description: 'Optional short label for version history.' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: 'Signature field payloads keyed by role.' })
  @IsOptional()
  @IsObject()
  signatures?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Required when draft has blocking compose gaps.' })
  @IsOptional()
  @IsBoolean()
  gapAcknowledged?: boolean;
}
