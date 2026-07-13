import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // No revelar la tecnología del servidor
  app.disable('x-powered-by');

  // Límites de tamaño de cuerpo (las imágenes van por multipart, esto cubre JSON)
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
