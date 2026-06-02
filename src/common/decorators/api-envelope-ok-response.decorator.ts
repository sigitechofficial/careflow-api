import { applyDecorators, Type } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

type EnvelopeExample = Record<string, unknown>;

/**
 * Documents a 200 response with a curated wire-format example (`ResponseInterceptor` envelope).
 * Optionally references an inner DTO schema for the `data` payload shape.
 */
export function ApiEnvelopeOkResponse(options: {
  description?: string;
  example: EnvelopeExample;
  innerType?: Type<unknown>;
}) {
  const description =
    options.description ??
    'Success (`{ success, message, data, meta }` from ResponseInterceptor)';

  if (options.innerType) {
    return applyDecorators(
      ApiOkResponse({
        description: `${description}. Inner \`data\` shape: ${options.innerType.name}.`,
        schema: {
          example: options.example,
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { $ref: getSchemaPath(options.innerType) },
            meta: { type: 'object' },
          },
        },
      }),
    );
  }

  return applyDecorators(
    ApiOkResponse({
      description,
      schema: { example: options.example },
    }),
  );
}

/** Same as {@link ApiEnvelopeOkResponse} for 201 Created. */
export function ApiEnvelopeCreatedResponse(options: {
  description?: string;
  example: EnvelopeExample;
  innerType?: Type<unknown>;
}) {
  const description =
    options.description ??
    'Created (`{ success, message, data, meta }` from ResponseInterceptor)';

  if (options.innerType) {
    return applyDecorators(
      ApiCreatedResponse({
        description: `${description}. Inner \`data\` shape: ${options.innerType.name}.`,
        schema: {
          example: options.example,
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { $ref: getSchemaPath(options.innerType) },
            meta: { type: 'object' },
          },
        },
      }),
    );
  }

  return applyDecorators(
    ApiCreatedResponse({
      description,
      schema: { example: options.example },
    }),
  );
}
