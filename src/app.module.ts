import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TeacherApplicationsModule } from './teacher-applications/teacher-applications.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthController } from './health.controller';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]), PrismaModule, AuthModule, TeacherApplicationsModule, NotificationsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
