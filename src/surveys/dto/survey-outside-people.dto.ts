import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export class OutsideContactDto {
  @ApiProperty({ enum: ['FAMILY', 'PROFESSIONAL', 'COMMISSIONER', 'OTHER'] })
  @IsIn(['FAMILY', 'PROFESSIONAL', 'COMMISSIONER', 'OTHER'])
  kind!: 'FAMILY' | 'PROFESSIONAL' | 'COMMISSIONER' | 'OTHER';

  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) organisation?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) role?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) mobile?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Branches (empty = your branches, or the whole organisation)' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class OutsideOptOutDto {
  @ApiProperty({ type: [String], description: 'ALL, EMAIL, TEXT, PHONE; empty = may be contacted' })
  @IsArray() @ArrayMaxSize(4) @IsIn(['ALL', 'EMAIL', 'TEXT', 'PHONE'], { each: true })
  channels!: string[];
}

export class OutsideSourceDto {
  @ApiProperty({ enum: ['FUNDER', 'PATHWAY_PROFESSIONAL'] })
  @IsIn(['FUNDER', 'PATHWAY_PROFESSIONAL'])
  type!: 'FUNDER' | 'PATHWAY_PROFESSIONAL';

  @ApiProperty() @IsUUID() sourceId!: string;
}

export class OutsideListDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) contactIds!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) locationIds?: string[];
}

class OverrideDto {
  @ApiProperty() @IsString() @MaxLength(300) reason!: string;
}

export class SendOutsideDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) contactIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) listIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'People involved (ServiceUserContact) ids: families who agreed to be contacted' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  familyContactIds?: string[];

  @ApiPropertyOptional({ description: 'The person we support this survey is about (found from their record)', nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID()
  aboutServiceUserId?: string | null;

  @ApiPropertyOptional({ description: 'Also send to people surveyed in the last 4 weeks, with the reason (audited)' })
  @IsOptional() @ValidateNested() @Type(() => OverrideDto)
  contactRuleOverride?: OverrideDto;
}
