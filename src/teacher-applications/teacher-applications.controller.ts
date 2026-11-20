import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReviewTeacherApplicationDto } from './review-teacher-application.dto';
import { TeacherApplicationsService } from './teacher-applications.service';
@Controller('admin/teacher-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class TeacherApplicationsController {
  constructor(private readonly service: TeacherApplicationsService) {}
  @Get() listPending() { return this.service.listPending(); }
  @Patch(':id/review') review(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReviewTeacherApplicationDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.review(id, dto, req.user.userId);
  }
}
