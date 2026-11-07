import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Both are checked in full by survey-contact-rule.util.ts (checkContactRuleInput, checkSamplingInput). */
export class SaveSurveyContactRuleDto {
  @ApiPropertyOptional({ description: '{ holdBack, countsAsContact, reason }, or null for the default', nullable: true, type: Object })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  rule?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: '{ percent } (5–100), or null to send to everyone', nullable: true, type: Object })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  sampling?: Record<string, unknown> | null;
}

export class SendHeldBackDto {
  @ApiPropertyOptional({ type: [String], description: 'Held-back rows to send now; empty or absent = everyone waiting' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  heldIds?: string[];

  @ApiProperty({ description: 'Why they are sent it before their free day (5–300 characters)' })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}
