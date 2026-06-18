import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

type StandardResponse = {
  success: boolean;
  message: string;
  data?: unknown;
  meta?: unknown;
  warnings?: unknown;
  requiresConfirmation?: boolean;
  jobStatus?: unknown;
};

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((result: any): StandardResponse => {
        if (result && typeof result === 'object' && 'success' in result) {
          return result as StandardResponse;
        }

        if (
          result &&
          typeof result === 'object' &&
          ('data' in result || 'meta' in result || 'message' in result)
        ) {
          const payload = result as Record<string, unknown>;
          const response: StandardResponse & Record<string, unknown> = {
            success: true,
            message: (payload.message as string | undefined) ?? 'Request successful',
            data: payload.data ?? result,
            meta: (payload.meta as unknown) ?? {},
          };
          if (payload.warnings !== undefined) response.warnings = payload.warnings;
          if (typeof payload.requiresConfirmation === 'boolean') {
            response.requiresConfirmation = payload.requiresConfirmation;
          }
          if (payload.jobStatus !== undefined) response.jobStatus = payload.jobStatus;
          return response;
        }

        return {
          success: true,
          message: 'Request successful',
          data: result ?? {},
          meta: {},
        };
      }),
    );
  }
}

