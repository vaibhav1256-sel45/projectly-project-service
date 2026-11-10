import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true,forbidNonWhitelisted:true,transform:true }));
  const configService = app.get(ConfigService);
  app.connectMicroservice({
    transport: Transport.GRPC,
    options: {
      package: 'project',
      protoPath: join(import.meta.dirname, './proto/project.proto'),
      url: configService.getOrThrow<string>('grpc.url'),
      loader: { keepCase: true },
    },
  });

  const config = new DocumentBuilder()
    .setTitle('Project API')
    .setDescription('Project API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
   app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
  await app.startAllMicroservices();
  // Health check: answered by the HTTP adapter itself, so no auth guard or response wrapper is involved.
  app.getHttpAdapter().get('/health', (_req: any, res: any) =>
    res.status(200).json({ status: 'ok', service: 'project-service', uptime: Math.round(process.uptime()) }),
  );

  // Graceful shutdown: on SIGTERM / SIGINT the app stops taking requests, closes the gRPC and
  // RabbitMQ listeners, and lets the database / Redis connections close before the process exits.
  app.enableShutdownHooks();

  await app.listen(configService.getOrThrow<number>('port'));
}
await bootstrap();
