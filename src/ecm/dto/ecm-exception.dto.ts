import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum EcmExceptionLifecycleDto {
  DETECTED = 'DETECTED',
  ALERT_GENERATED = 'ALERT_GENERATED',
  ASSIGNED = 'ASSIGNED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  INVESTIGATING = 'INVESTIGATING',
  ACTION_TAKEN = 'ACTION_TAKEN',
  RESOLVED = 'RESOLVED',
  MANAGER_REVIEWED = 'MANAGER_REVIEWED',
  CLOSED = 'CLOSED',
}

export class AcknowledgeEcmExceptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ResolveEcmExceptionDto {
  @ApiProperty({ description: 'Structured reason code key' })
  @IsString()
  @MaxLength(80)
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class CloseEcmExceptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
