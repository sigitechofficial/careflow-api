import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server } from 'http';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  const uploadPath = join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads');
  // Allow logos/photos to render from a different SPA origin (admin host ≠ API host).
  // Also expose the same files under /files/uploads/* — some hosts intercept bare /uploads
  // before the Node app, which breaks <img> after deploy while local Vite /api proxy works.
  const uploadStaticHeaders = (
    res: { setHeader: (name: string, value: string) => void },
  ) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  };
  app.useStaticAssets(uploadPath, {
    prefix: '/uploads/',
    setHeaders: uploadStaticHeaders,
  });
  app.useStaticAssets(uploadPath, {
    prefix: '/files/uploads/',
    setHeaders: uploadStaticHeaders,
  });

  app.enableCors({
    origin: true,
    credentials: true,
    // Cache the CORS preflight response in the browser for 10 minutes so
    // routine SPA navigation does not generate an OPTIONS round-trip before
    // every distinct API call.
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const config = app.get(ConfigService);
  const swaggerPath = config.get<string>('app.swaggerPath', 'api/docs');
  const swaggerTitle = config.get<string>('app.swaggerTitle', 'CareAdmin API');
  const swaggerDescription = config.get<string>(
    'app.swaggerDescription',
    'CareAdmin backend API',
  );
  const swaggerVersion = config.get<string>('app.swaggerVersion', '1.0.0');

  const swaggerConfig = new DocumentBuilder()
    .setTitle(swaggerTitle)
    .setDescription(swaggerDescription)
    .setVersion(swaggerVersion)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(swaggerPath, app, document);

  const port = config.get<number>('app.port', 3000);
  // Bind all interfaces so phones/emulators can reach the API via LAN IP (not only localhost).
  const host = config.get<string>('app.host', '0.0.0.0');
  const httpRequestTimeoutMs = config.get<number>('app.httpRequestTimeoutMs', 120_000);
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`CareAdmin API listening on http://${host}:${port} (use LAN IP from another device)`);
  const server = app.getHttpServer() as Server;
  server.requestTimeout = httpRequestTimeoutMs;
  server.headersTimeout = Math.min(httpRequestTimeoutMs + 10_000, 190_000);
}
bootstrap();
