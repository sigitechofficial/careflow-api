/**
 * Writes OpenAPI 3 document to openapi/openapi.json (repo root: careadmin-backend/).
 * Usage: pnpm run openapi:export
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const config = new DocumentBuilder()
    .setTitle(process.env.SWAGGER_TITLE ?? 'CareAdmin API')
    .setDescription(process.env.SWAGGER_DESCRIPTION ?? 'CareAdmin backend API')
    .setVersion(process.env.SWAGGER_VERSION ?? '1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const outDir = join(process.cwd(), 'openapi');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf8');
  const pathCount = Object.keys(document.paths ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${pathCount} paths)`);
  await app.close();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
