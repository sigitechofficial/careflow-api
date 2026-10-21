import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { validateSync } from 'class-validator';

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

  @IsOptional()
  @IsString()
  OPENDFDA_API_KEY?: string;

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

  /** `smtp` | `log` — `smtp` for Azure Communication Services. */
  @IsOptional()
  @IsString()
  MAIL_MODE?: string;

  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

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
  return validatedConfig;
}

