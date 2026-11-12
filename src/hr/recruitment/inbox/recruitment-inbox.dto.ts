import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

/** The checked form on the recruitment inbox: everything Claude read can be corrected before saving. */
export class CreateCandidateFromEmailDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiProperty() @IsUUID() vacancyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) coverLetter?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean() hasRightToWork?: boolean | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean() drivesForWork?: boolean | null;
  @ApiPropertyOptional({ description: 'Fill in the employment history read from the CV (default true).' })
  @IsOptional()
  @IsBoolean()
  includeEmploymentHistory?: boolean;
  @ApiPropertyOptional({ description: 'Which attachments to copy to the candidate (default: all).', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(0, { each: true })
  attachmentIndexes?: number[];
  @ApiPropertyOptional({ description: 'The attachment that is the CV.' }) @IsOptional() @IsString() @MaxLength(300) cvFileName?: string;
}
