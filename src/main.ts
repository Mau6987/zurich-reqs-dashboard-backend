import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // CORS
  const originsRaw = config.get<string>('CORS_ORIGINS', '');
  if (originsRaw) {
    app.enableCors({
      origin: originsRaw.split(',').map((o) => o.trim()),
      credentials: true,
      methods: 'GET,PATCH,POST,OPTIONS',
      allowedHeaders: 'authorization,content-type,prefer,range,accept',
    });
  } else {
    app.enableCors({
      origin: '*',
      methods: 'GET,PATCH,POST,OPTIONS',
      allowedHeaders: 'authorization,content-type,prefer,range,accept',
    });
  }

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);

  console.log(`[zurich-backend] Escuchando en http://localhost:${port}`);
  console.log(`[zurich-backend] API PostgREST: http://localhost:${port}/api/:view`);
  console.log(`[zurich-backend] Webhook proxy: http://localhost:${port}/api/ui/accion`);
  console.log(`[zurich-backend] Health check:  http://localhost:${port}/health`);
}
bootstrap();
