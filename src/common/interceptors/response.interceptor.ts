import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { trackedHoursRequests } from '../request-context/super-admin-context';
import { stripSecretFields } from '../security/secret-fields';

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
      map(withHoursRequests),
      // Last safety net: no response body may carry a credential column (passwordHash, refreshTokenHash...),
      // even when a query included a whole User row by mistake.
      map(stripSecretFields),
    );
  }
}

/** Hours requests this request sent for manager approval: listed in meta so a manager can approve them at once. */
function withHoursRequests(res: StandardResponse | StreamableFile): StandardResponse | StreamableFile {
  const ids = trackedHoursRequests();
  if (!ids.length || res instanceof StreamableFile) return res;
  const meta = res.meta && typeof res.meta === 'object' ? res.meta : {};
  return { ...res, meta: { ...meta, hoursRequestIds: ids } };
}
