import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditStatus } from '@prisma/client';

/**
 * Internal documentation shape for programmatic audit creation (no public POST API).
 */
export class CreateAuditLogDto {
  @ApiPropertyOptional()
  userId?: string | null;

  @ApiPropertyOptional()
  module!: string;

  @ApiPropertyOptional()
  action!: string;

  @ApiPropertyOptional()
  recordType?: string | null;

  @ApiPropertyOptional()
  recordId?: string | null;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  oldValues?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  newValues?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  ipAddress?: string | null;

  @ApiPropertyOptional()
  userAgent?: string | null;

  @ApiPropertyOptional({ enum: AuditStatus })
  status?: AuditStatus;
}
