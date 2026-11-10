import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ResponseInterceptor } from "./Interceptors/response.interceptors.js";
import { ErrorInterceptor } from "./Interceptors/error.interceptors.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import configuration from "./config/configuration.js";
import { LoggerModule } from "nestjs-pino";
import {MongooseModule} from '@nestjs/mongoose'
import { Project, ProjectSchema } from "./schemas/project.schema.js";
import { Invitation, InvitationSchema } from "./schemas/invitation.schema.js";
import { ProjectController } from "./project.controller.js";
import { ProjectService } from "./project.service.js";
import { ClientsModule, Transport } from '@nestjs/microservices'
import { join } from 'path'
import { AuthGuard } from './guards/auth.guard.js'
import { AuthClient } from './auth/auth-client.service.js'
import { GrpcBreaker } from './grpc/grpc-breaker.service.js'
@Module({
 imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('mongo.uri'),
      }),
    }),
    MongooseModule.forFeature([
      {
        name: Project.name,
        schema: ProjectSchema,
      },
      {
        name: Invitation.name,
        schema: InvitationSchema,
      },
    ]),
    ClientsModule.registerAsync([
      {
        name: 'AUTH',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'auth',
            protoPath: join(import.meta.dirname, 'proto/auth.proto'),
            url: configService.getOrThrow<string>('grpc.authUrl'),
            loader: { keepCase: true },
          },
        }),
      },
      {
        name: 'USER',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'user',
            protoPath: join(import.meta.dirname, 'proto/user.proto'),
            url: configService.getOrThrow<string>('grpc.userUrl'),
            loader: { keepCase: true },
          },
        }),
      },
      {
        // asks common-service to send emails (OTP code, ...)
        name: 'MAIL',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.getOrThrow<string>('rabbitmq.url')],
            queue: 'mail_events',
            persistent: true, // messages survive a broker restart
            queueOptions: { durable: true },
          },
        }),
      },
      {
        // publishes project events (project.deleted) to RabbitMQ
        name: 'EVENTS',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.getOrThrow<string>('rabbitmq.url')],
            queue: 'project_events',
            persistent: true, // messages survive a broker restart
            queueOptions: { durable: true },
          },
        }),
      },
       {
        name: 'TASK',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'task',
            protoPath: join(import.meta.dirname, 'proto/task.proto'),
            url: configService.getOrThrow<string>('grpc.taskUrl'),
            loader: { keepCase: true, defaults: true },
          },
        }),
      },
    ]),
  ],
  controllers: [ProjectController],
  providers: [
    AuthClient,
    GrpcBreaker,
    ProjectService,
    
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ErrorInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard, 
    }

  ],
})

export class ProjectModule{}