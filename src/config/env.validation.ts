import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { validateSync } from 'class-validator';
import { resolveMailMode } from './mail.config';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  ENABLE_DEV_TOOLS?: string;

  /** Narrow flag for POST /dev/generate-ia-section only. Does not enable ENABLE_DEV_TOOLS. */
  @IsOptional()
  @IsString()
  ENABLE_IA_QA_DEMO?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_TOKEN_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_TOKEN_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TOKEN_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_TOKEN_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  SWAGGER_TITLE?: string;

  @IsOptional()
  @IsString()
  SWAGGER_DESCRIPTION?: string;

  @IsOptional()
  @IsString()
  SWAGGER_VERSION?: string;

  @IsOptional()
  @IsString()
  SWAGGER_PATH?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  UPLOAD_MAX_FILE_SIZE_BYTES?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  MAX_UPLOAD_FILE_SIZE_MB?: number;

  @IsOptional()
  @IsString()
  UPLOAD_BASE_PATH?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  RATE_LIMIT_TTL_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  HTTP_REQUEST_TIMEOUT_MS?: number;

  /** Reverse-proxy hops in front of the API to trust for X-Forwarded-For (0 = none; Azure Container Apps = 1). */
  @IsOptional()
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS?: number;

  @IsOptional()
  @IsString()
  OPENDFDA_API_KEY?: string;

  /** ZeptoMail REST send URL (default https://api.zeptomail.com/v1.1/email). */
  @IsOptional()
  @IsString()
  MAIL_API_URL?: string;

  @IsOptional()
  @IsString()
  ZEPTOMAIL_API_URL?: string;

  /** ZeptoMail Send Mail Token (`Zoho-enczapikey …`). */
  @IsOptional()
  @IsString()
  MAIL_API_TOKEN?: string;

  @IsOptional()
  @IsString()
  ZEPTOMAIL_API_TOKEN?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  MAIL_FROM?: string;

  /** `api` | `smtp` | `log` — prefer `api` (ZeptoMail HTTP). */
  @IsOptional()
  @IsString()
  MAIL_MODE?: string;

  /** Admin site origin used for password reset links (`<base>/auth/reset-password?token=…`). */
  @IsOptional()
  @IsString()
  PASSWORD_RESET_URL_BASE?: string;

  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

  /** Comma-separated browser origins allowed by CORS (HTTP + Socket.io). */
  @IsOptional()
  @IsString()
  ALLOWED_ORIGINS?: string;

  /** `true` / `false` to force Swagger UI on/off (default: off in production). */
  @IsOptional()
  @IsString()
  SWAGGER_ENABLED?: string;

  /** Azure Pricing: `true` enables the read-only Azure sync jobs (default off). */
  @IsOptional()
  @IsIn(['true', 'false'])
  AZURE_COST_ENABLED?: string;

  /** Required when AZURE_COST_ENABLED=true and AZURE_COST_SCOPE is not set. */
  @ValidateIf(
    (o: EnvironmentVariables) =>
      o.AZURE_COST_ENABLED === 'true' && !o.AZURE_COST_SCOPE,
  )
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/, {
    message: 'AZURE_COST_SUBSCRIPTION_ID must be a subscription GUID',
  })
  AZURE_COST_SUBSCRIPTION_ID?: string;

  /** Cost query scope (default `/subscriptions/${AZURE_COST_SUBSCRIPTION_ID}`). */
  @IsOptional()
  @IsString()
  @Matches(
    /^\/subscriptions\/[0-9a-fA-F-]{36}(\/resourceGroups\/[^/]+)?\/?$/i,
    {
      message:
        'AZURE_COST_SCOPE must be /subscriptions/{id} or /subscriptions/{id}/resourceGroups/{rg}',
    },
  )
  AZURE_COST_SCOPE?: string;

  /** Comma-separated resource groups to include (case-insensitive). */
  @IsOptional()
  @IsString()
  AZURE_COST_RESOURCE_GROUPS?: string;

  /** Retail price region (default uksouth). */
  @IsOptional()
  @IsString()
  AZURE_COST_REGION?: string;

  /** Retail price currency (default GBP). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'AZURE_COST_CURRENCY must be a 3-letter currency code',
  })
  AZURE_COST_CURRENCY?: string;

  /** Scheduled jobs: `internal` (default, in-process @Cron) | `external` (Azure Functions / Container Apps Jobs). */
  @IsOptional()
  @IsIn(['internal', 'external'])
  CRON_MODE?: string;

  /** Shared secret for POST /internal/jobs/:name (header x-jobs-trigger-secret). Unset = endpoint disabled. */
  @ValidateIf((o: EnvironmentVariables) => Boolean(o.JOBS_TRIGGER_SECRET))
  @IsString()
  @MinLength(16, {
    message: 'JOBS_TRIGGER_SECRET must be at least 16 characters',
  })
  JOBS_TRIGGER_SECRET?: string;
}

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    const formatted = errors
      .map((e) => {
        const constraints = e.constraints
          ? Object.values(e.constraints).join(', ')
          : 'invalid';
        return `${e.property}: ${constraints}`;
      })
      .join('; ');
    throw new Error(`Environment validation failed: ${formatted}`);
  }
  // Production must never fall back to a made-up sender: MAIL_FROM is required whenever a
  // real transport (acs / api / smtp) is active.
  if (
    envString(config.NODE_ENV) === 'production' &&
    resolveMailMode(config) !== 'log' &&
    !envString(config.MAIL_FROM)
  ) {
    throw new Error(
      'Environment validation failed: MAIL_FROM is required in production when email sending is enabled (e.g. "Allfor Care <noreply@allforcare.co.uk>")',
    );
  }
  return validatedConfig;
}
