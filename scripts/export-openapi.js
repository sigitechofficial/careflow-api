"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("../src/app.module");
async function main() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: ['error'] });
    const config = new swagger_1.DocumentBuilder()
        .setTitle(process.env.SWAGGER_TITLE ?? 'CareAdmin API')
        .setDescription(process.env.SWAGGER_DESCRIPTION ?? 'CareAdmin backend API')
        .setVersion(process.env.SWAGGER_VERSION ?? '1.0.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    const outDir = (0, path_1.join)(process.cwd(), 'openapi');
    (0, fs_1.mkdirSync)(outDir, { recursive: true });
    const outPath = (0, path_1.join)(outDir, 'openapi.json');
    (0, fs_1.writeFileSync)(outPath, JSON.stringify(document, null, 2), 'utf8');
    const pathCount = Object.keys(document.paths ?? {}).length;
    console.log(`Wrote ${outPath} (${pathCount} paths)`);
    await app.close();
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=export-openapi.js.map