import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewTeacherApplicationDto } from './review-teacher-application.dto';
@Injectable()
export class TeacherApplicationsService {
  constructor(private readonly prisma: PrismaService) {}
  listPending() {
    return this.prisma.teacherApplication.findMany({ where: { status:'PENDING' }, orderBy:{submittedAt:'asc'},
      select:{id:true,status:true,submittedAt:true,user:{select:{id:true,email:true,displayName:true}}} });
  }
  async review(id:string, dto:ReviewTeacherApplicationDto, adminId:string) {
    return this.prisma.$transaction(async tx => {
      const app = await tx.teacherApplication.findUnique({where:{id},select:{id:true,userId:true,status:true}});
      if (!app) throw new NotFoundException('Application not found.');
      if (app.status !== 'PENDING') throw new BadRequestException('Application already reviewed.');

      // Conditional update prevents two Admins approving/rejecting the same request concurrently.
      const claimed = await tx.teacherApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: { status:dto.decision, reviewedAt:new Date(), reviewedBy:adminId, reviewNote:dto.note },
      });
      if (claimed.count !== 1) throw new BadRequestException('Application was already reviewed. Refresh the list.');
      await tx.user.update({where:{id:app.userId},data:{status:dto.decision==='APPROVED'?'ACTIVE':'DISABLED', tokenVersion:{increment:1}}});
      await tx.auditLog.create({data:{actorUserId:adminId,action:`TEACHER_APPLICATION_${dto.decision}`,entityType:'TeacherApplication',entityId:id,metadata:{note:dto.note??null}}});
      return {id:app.id,status:dto.decision,reviewedAt:new Date()};
    });
  }
}
