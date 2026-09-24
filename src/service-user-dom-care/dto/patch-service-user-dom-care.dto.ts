import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class PatchServiceUserDomCareDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  accessInstruction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  accessRisks?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  doorCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  careInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  weeklyContractedHours?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  numberOfCarers?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  preferredEmployeeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  blockedEmployeeIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  staffGenderPreference?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accommodationType?: string[] | null;
}
