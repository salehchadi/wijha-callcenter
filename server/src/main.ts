import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new PrismaExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS: In production set FRONTEND_URL in Railway env vars (comma-separated for multiple origins).
  // Example: FRONTEND_URL=https://your-app.vercel.app
  // To switch to a different host (e.g. Google Cloud Run), just update this env var.
  const rawFrontendUrl = process.env.FRONTEND_URL;

  if (rawFrontendUrl) {
    // Parse, clean, and normalize each origin
    const allowedOrigins = rawFrontendUrl
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
      .filter((o) => o.length > 0);

    console.log('CORS allowed origins:', allowedOrigins);

    app.enableCors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (e.g. server-to-server, curl, native mobile apps)
        if (!origin) {
          callback(null, true);
          return;
        }
        
        const normalized = origin.trim().replace(/\/+$/, '').toLowerCase();
        
        // Allow known web origins OR common mobile webview schemes
        const isMobileWebview = 
          normalized.startsWith('capacitor://') || 
          normalized.startsWith('ionic://') || 
          normalized.startsWith('file://');

        if (allowedOrigins.includes(normalized) || isMobileWebview) {
          callback(null, true);
        } else {
          console.warn(`CORS blocked origin: "${origin}" (normalized: "${normalized}")`);
          callback(null, false);
        }
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });
  } else {
    // Dev mode: allow all origins
    console.log('CORS: No FRONTEND_URL set — allowing all origins (dev mode)');
    app.enableCors();
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/api (v1, v2)`);
}
bootstrap();

