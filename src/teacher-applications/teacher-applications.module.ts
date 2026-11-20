import { Module } from '@nestjs/common';
import { TeacherApplicationsController } from './teacher-applications.controller';
import { TeacherApplicationsService } from './teacher-applications.service';
import { RolesGuard } from '../auth/roles.guard';
@Module({ controllers: [TeacherApplicationsController], providers: [TeacherApplicationsService, RolesGuard] })
export class TeacherApplicationsModule {}
