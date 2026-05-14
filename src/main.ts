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
  app.useStaticAssets(uploadPath, { prefix: '/uploads/' });

  app.enableCors({
    origin: true,
    credentials: true,
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
  const httpRequestTimeoutMs = config.get<number>('app.httpRequestTimeoutMs', 120_000);
  await app.listen(port);
  const server = app.getHttpServer() as Server;
  server.requestTimeout = httpRequestTimeoutMs;
  server.headersTimeout = Math.min(httpRequestTimeoutMs + 10_000, 190_000);
}
bootstrap();
