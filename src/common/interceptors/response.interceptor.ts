import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

type StandardResponse = {
  success: boolean;
  message: string;
  data?: unknown;
  meta?: unknown;
};

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((result: any): StandardResponse | StreamableFile => {
        // Binary downloads / media streams must not be JSON-wrapped.
        if (result instanceof StreamableFile) {
          return result;
        }

        if (result && typeof result === 'object' && 'success' in result) {
          return result as StandardResponse;
        }

        if (
          result &&
          typeof result === 'object' &&
          ('data' in result || 'meta' in result || 'message' in result)
        ) {
          return {
            success: true,
            message: result.message ?? 'Request successful',
            data: result.data ?? result,
            meta: result.meta ?? {},
          };
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
