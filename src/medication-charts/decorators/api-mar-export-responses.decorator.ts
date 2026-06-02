import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ApiMedicationStandardResponses } from '../../common/decorators/api-standard-responses.decorator';

/** Documents MAR export binary/text responses (format query selects Content-Type). */
export function ApiMarExportResponses() {
  return applyDecorators(
    ApiMedicationStandardResponses(),
    ApiResponse({
      status: 200,
      description:
        'MAR export file (Content-Type depends on `format`). Blister packs: use `packExportDetail=summary` for compartment rows only, or `full` (default) to include individual medicine rows inside each pack section.',
      content: {
        'text/html': {
          schema: { type: 'string', description: 'Printable HTML MAR (default)' },
        },
        'application/pdf': {
          schema: { type: 'string', format: 'binary' },
        },
        'text/csv': {
          schema: { type: 'string', description: 'UTF-8 CSV with BOM' },
        },
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    }),
  );
}
