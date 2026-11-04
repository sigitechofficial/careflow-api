import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Multipart fields sent alongside the uploaded `file`. */
export class CreatePathwayDocumentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'e.g. DNACPR, Hospital passport, EHCP' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}
