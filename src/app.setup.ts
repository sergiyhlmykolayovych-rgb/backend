import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

const parseOrigins = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

// Спільне налаштування застосунку для main.ts та e2e-тестів,
// щоб тести перевіряли ті самі префікси, валідацію й фільтри, що працюють у бою.
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      // Фото проєктів сайт і адмінка показують зі свого домену.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const origins = [
    ...parseOrigins(process.env.SITE_URL),
    ...parseOrigins(process.env.ADMIN_URL),
  ];

  if (origins.length === 0) {
    throw new Error('SITE_URL and ADMIN_URL are not configured');
  }

  // Сайт надсилає форми, адмінка входить із куками: credentials потрібні саме їй.
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
}
