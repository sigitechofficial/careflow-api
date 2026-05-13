import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsOnOrAfterDate } from '../../common/validators/date-order.validator';

export class UpdateServiceUserAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  keyWorkerId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  namedNurseId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  @IsOnOrAfterDate('startDate')
  endDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
