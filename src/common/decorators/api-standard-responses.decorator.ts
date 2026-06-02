import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-error-response.dto';
import {
  API_NOT_FOUND_ERROR_EXAMPLE,
  API_VALIDATION_ERROR_EXAMPLE,
} from '../swagger/api-envelope.example';

/** Documents typical JWT + permission + validation + not-found responses for medication APIs. */
export function ApiMedicationStandardResponses() {
  return applyDecorators(
    ApiBadRequestResponse({
      type: ApiErrorResponseDto,
      description: 'Validation failed or business rule rejected the request',
      schema: { example: API_VALIDATION_ERROR_EXAMPLE },
    }),
    ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' }),
    ApiForbiddenResponse({ description: 'Authenticated but missing required permission' }),
    ApiNotFoundResponse({
      type: ApiErrorResponseDto,
      description: 'Service user, medication, event, or related resource not found',
      schema: { example: API_NOT_FOUND_ERROR_EXAMPLE },
    }),
  );
}
