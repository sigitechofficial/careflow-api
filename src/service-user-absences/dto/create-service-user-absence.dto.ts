import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export type ServiceUserAbsenceTypeApi = 'PLANNED' | 'UNPLANNED' | 'NOT_APPLICABLE';

export class CreateServiceUserAbsenceDto {
  @IsDateString()
  startDate!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @Matches(TIME_RE, { message: 'startTime must be HH:mm (24h)' })
  startTime?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @Matches(TIME_RE, { message: 'endTime must be HH:mm (24h)' })
  endTime?: string | null;

  @IsOptional()
  @IsIn(['PLANNED', 'UNPLANNED', 'NOT_APPLICABLE'])
  absenceType?: ServiceUserAbsenceTypeApi;

  @IsUUID()
  absenceReasonCatalogId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  contactInformation?: string;
}
