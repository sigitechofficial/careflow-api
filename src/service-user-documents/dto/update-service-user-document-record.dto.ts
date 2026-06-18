import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ServiceUserDocumentAccessLevel,
  ServiceUserDocumentRecordStatus,
} from '@prisma/client';

export class UpdateServiceUserDocumentRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  expiryDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  physicalLocationInHome?: string | null;

  @IsOptional()
  @IsEnum(ServiceUserDocumentAccessLevel)
  accessLevel?: ServiceUserDocumentAccessLevel;

  @IsOptional()
  @IsEnum(ServiceUserDocumentRecordStatus)
  status?: ServiceUserDocumentRecordStatus;

  @IsOptional()
  @IsUUID()
  supersedesDocumentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  linkedRecordType?: string | null;

  @IsOptional()
  @IsUUID()
  linkedRecordId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
