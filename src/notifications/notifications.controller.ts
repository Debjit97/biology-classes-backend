import { Body, Controller, Get, Patch, Post, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post('admin/notifications')
  @Roles('ADMIN')
  adminSend(@Body() dto: CreateNotificationDto, @Req() req: Request & {user:{userId:string}}) {
    return this.service.createAndQueue(dto, req.user.userId, 'ADMIN');
  }

  @Post('teacher/notifications')
  @Roles('TEACHER')
  teacherSend(@Body() dto: CreateNotificationDto, @Req() req: Request & {user:{userId:string}}) {
    return this.service.createAndQueue(dto, req.user.userId, 'TEACHER');
  }

  @Get('notifications/inbox')
  @Roles('ADMIN','TEACHER','STUDENT')
  inbox(@Req() req: Request & {user:{userId:string}}) {
    return this.service.getInbox(req.user.userId);
  }

  @Patch('notifications/:id/read')
  @Roles('ADMIN','TEACHER','STUDENT')
  markRead(@Param('id', new ParseUUIDPipe()) id:string, @Req() req: Request & {user:{userId:string}}) {
    return this.service.markRead(id, req.user.userId);
  }
}
