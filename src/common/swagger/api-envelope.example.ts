/** Standard success envelope from `ResponseInterceptor`. */
export type ApiSuccessEnvelope<TData = unknown, TMeta = Record<string, unknown>> = {
  success: true;
  message: string;
  data: TData;
  meta: TMeta;
};

export function wrapApiEnvelope<TData, TMeta extends Record<string, unknown> = Record<string, never>>(
  data: TData,
  meta: TMeta = {} as TMeta,
  message = 'Request successful',
): ApiSuccessEnvelope<TData, TMeta> {
  return { success: true, message, data, meta };
}

export const API_VALIDATION_ERROR_EXAMPLE = {
  success: false,
  message: 'Validation failed',
  errors: ['month must be YYYY-MM'],
} as const;

export const API_NOT_FOUND_ERROR_EXAMPLE = {
  success: false,
  message: 'Service user not found',
} as const;
