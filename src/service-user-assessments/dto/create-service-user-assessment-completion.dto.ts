import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateServiceUserAssessmentCompletionDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @ApiPropertyOptional({ description: 'Raw completion snapshot.' })
  @IsOptional()
  @IsObject()
  snapshot?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Display title when registering a new assessment line.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Care Pathway ASSESSMENT form id for ad-hoc tools (e.g. SALT).' })
  @IsOptional()
  @IsUUID()
  carePathwayFormId?: string;

  @ApiPropertyOptional({ description: 'Copy snapshot from a prior completion when repeating.' })
  @IsOptional()
  @IsUUID()
  repeatFromCompletionId?: string;
}
