import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '')
    ? undefined
    : value;

/**
 * Query booleans: "false" / "0" are false, anything else given is true, missing keeps the default. Reads the raw
 * query value (`obj[key]`): implicit conversion has already turned the string "false" into true in `value`.
 */
export const queryBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  return !(value === false || value === 'false' || value === '0');
};

export class EvidencePackQueryDto {
  @ApiProperty({
    enum: ['pdf', 'zip'],
    description:
      'pdf: one document. zip: the PDF with the files, policies and a CSV.',
  })
  @IsIn(['pdf', 'zip'])
  format!: 'pdf' | 'zip';

  @ApiPropertyOptional({
    description: 'One key question (e.g. SAFE); omit for every key question',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(40)
  keyQuestionCode?: string;

  @ApiPropertyOptional({
    description: 'One quality statement; takes priority over keyQuestionCode',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  statementId?: string;

  @ApiPropertyOptional({
    description: 'Branch filter (that branch plus organisation-wide records)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'ZIP only: add the files attached to the evidence (default true)',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeFiles?: boolean;

  @ApiPropertyOptional({
    description:
      'Add the published policies behind the statements (default true; needs policies.read)',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includePolicies?: boolean;
}
