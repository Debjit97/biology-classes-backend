import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_ACCESS_SECRET ?? '';
  if (jwtSecret.length < 32 || jwtSecret.includes('REPLACE_WITH')) {
    throw new Error('JWT_ACCESS_SECRET must be a strong, unique secret of at least 32 characters.');
  }
  if (isProduction) {
    const mfaKey = process.env.MFA_ENCRYPTION_KEY ?? '';
    if (!/^[a-fA-F0-9]{64}$/.test(mfaKey)) {
      throw new Error('MFA_ENCRYPTION_KEY must be configured as 64 hexadecimal characters (32 random bytes) in production.');
    }
    if (jwtSecret.includes('CHANGE_THIS') || jwtSecret === 'ci_only_jwt_secret_at_least_32_characters_long') {
      throw new Error('Production must use a unique JWT_ACCESS_SECRET generated for this deployment.');
    }
  }
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  if (isProduction && origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain the exact trusted web application origins in production.');
  }
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by CORS policy'), false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
bootstrap();
