import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CallOffVisitStatus } from '../enums/call-off-status.enum';

export class UpdateCallOffVisitDto {
  @ApiPropertyOptional({ example: '2026-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  callOffDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ enum: CallOffVisitStatus })
  @IsOptional()
  @IsEnum(CallOffVisitStatus)
  status?: CallOffVisitStatus;
}
