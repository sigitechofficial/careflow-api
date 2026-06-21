import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class SyncScheduleRunCarerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unallocateEmployeeId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
