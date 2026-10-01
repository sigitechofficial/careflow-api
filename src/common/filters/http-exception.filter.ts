import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const fallbackStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    const fallbackMessage = 'Unexpected error';

    const { status, body } = this.toResponse(
      exception,
      fallbackStatus,
      fallbackMessage,
    );
    response.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    fallbackStatus: number,
    fallbackMessage: string,
  ): { status: number; body: unknown } {
    if (this.isMulterFileTooLarge(exception)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          success: false,
          message: 'File too large',
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as any;

      const message =
        typeof res?.message === 'string'
          ? res.message
          : Array.isArray(res?.message)
            ? 'Validation failed'
            : exception.message || fallbackMessage;

      const errors = Array.isArray(res?.message) ? res.message : undefined;

      return {
        status,
        body: {
          success: false,
          message,
          errors,
          // Contract error code (e.g. employee-app SUPPORT_READ_ONLY, OTHER_VISIT_ACTIVE).
          ...(typeof res?.code === 'string' ? { code: res.code } : {}),
          // Allocation checks: the admin "Allocate anyway" flow reads these.
          ...(Array.isArray(res?.warnings) ? { warnings: res.warnings } : {}),
          ...(typeof res?.requiresConfirmation === 'boolean'
            ? { requiresConfirmation: res.requiresConfirmation }
            : {}),
          ...(Array.isArray(res?.carers) ? { carers: res.carers } : {}),
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaKnownError(exception);
      return {
        status: mapped.status,
        body: {
          success: false,
          message: mapped.message,
          errors: mapped.errors,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(exception.message);
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          success: false,
          message: 'Invalid request data',
          errors: [exception.message],
        },
      };
    }

    const message =
      exception instanceof Error ? exception.message : fallbackMessage;
    this.logger.error(exception);

    return {
      status: fallbackStatus,
      body: {
        success: false,
        message:
          process.env.NODE_ENV === 'production' ? fallbackMessage : message,
      },
    };
  }

  private isMulterFileTooLarge(exception: unknown): boolean {
    if (exception == null || typeof exception !== 'object') return false;
    return (
      'code' in exception &&
      (exception as { code?: string }).code === 'LIMIT_FILE_SIZE'
    );
  }

  private mapPrismaKnownError(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    errors?: unknown[];
  } {
    switch (e.code) {
      case 'P2002': {
        const fields = this.prismaFields(
          (e.meta as { target?: unknown })?.target,
        );
        const message =
          fields.length === 1
            ? `${fields[0]} is already in use`
            : fields.length
              ? `Unique constraint failed: ${fields.join(', ')}`
              : 'A unique value is already in use';
        return {
          status: HttpStatus.CONFLICT,
          message,
          errors: fields.length
            ? fields.map((field) => `${field} is already in use`)
            : [message],
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
        };
      case 'P2003': {
        const field = this.prismaField(
          (e.meta as { field_name?: string })?.field_name,
        );
        const message = field
          ? `${field} is not a valid selection`
          : 'Related record not found (invalid reference)';
        return {
          status: HttpStatus.BAD_REQUEST,
          message,
          errors: [message],
        };
      }
      case 'P2021':
        return {
          status: HttpStatus.FAILED_DEPENDENCY,
          message:
            'A required database table is missing. From careadmin-backend run: pnpm exec prisma migrate deploy (or prisma migrate dev in development), then restart the API.',
          errors: [{ code: e.code, meta: e.meta }],
        };
      case 'P2022':
        return {
          status: HttpStatus.FAILED_DEPENDENCY,
          message:
            'A required database column is missing or out of sync. From careadmin-backend run: pnpm exec prisma migrate deploy && pnpm exec prisma generate, then restart the API.',
          errors: [{ code: e.code, meta: e.meta }],
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Database error',
          errors: [e.code ? `Database error (${e.code})` : 'Database error'],
        };
    }
  }

  private prismaFields(target: unknown): string[] {
    const items = Array.isArray(target)
      ? target
      : target != null
        ? [target]
        : [];
    const fields: string[] = [];
    for (const item of items) {
      const field = this.prismaField(String(item));
      if (field) fields.push(field);
    }
    return fields;
  }

  private prismaField(raw: string | undefined): string | null {
    if (!raw?.trim()) return null;
    const value = raw.trim();
    const constraint = value.match(/_([A-Za-z][A-Za-z0-9]*)_(?:key|fkey)$/);
    if (constraint?.[1]) return constraint[1];
    if (/^[A-Z][A-Za-z]+$/.test(value) && !value.endsWith('Id')) return null;
    return value;
  }
}
