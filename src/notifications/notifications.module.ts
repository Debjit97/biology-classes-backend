import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RolesGuard } from '../auth/roles.guard';
@Module({ controllers:[NotificationsController], providers:[NotificationsService,RolesGuard], exports:[NotificationsService] })
export class NotificationsModule {}
