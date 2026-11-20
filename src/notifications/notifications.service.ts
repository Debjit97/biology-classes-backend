import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel } from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAndQueue(dto:CreateNotificationDto, senderId:string, senderRole:'ADMIN'|'TEACHER') {
    if (dto.audience !== 'INDIVIDUAL' && dto.targetUserId) throw new ForbiddenException('A target user is only valid for individual notifications.');
    if (dto.audience !== 'BATCH' && dto.batchId) throw new ForbiddenException('A batch is only valid for batch notifications.');
    if (dto.deepLink && (!dto.deepLink.startsWith('/') || dto.deepLink.startsWith('//') || dto.deepLink.includes('\\'))) {
      throw new ForbiddenException('Deep links must be relative in-app paths.');
    }
    if (senderRole === 'TEACHER' && ['PAYMENT', 'SYSTEM'].includes(dto.category)) {
      throw new ForbiddenException('Teachers cannot send payment or system notifications.');
    }
    let recipientIds:string[] = [];
    if (dto.audience === 'INDIVIDUAL') {
      if (!dto.targetUserId) throw new ForbiddenException('Select a target user.');
      if (senderRole === 'ADMIN') {
        const target = await this.prisma.user.findUnique({where:{id:dto.targetUserId},select:{id:true,status:true}});
        if (!target || target.status !== 'ACTIVE') throw new NotFoundException('Active recipient not found.');
        recipientIds = [target.id];
      } else {
        // Teacher can message only a student sharing an actively assigned batch.
        const shared = await this.prisma.studentBatchEnrollment.findFirst({
          where:{studentId:dto.targetUserId,active:true,student:{status:'ACTIVE',roles:{some:{role:{name:'STUDENT'}}}},batch:{teacherAssignments:{some:{teacherId:senderId,active:true}}}},
          select:{studentId:true},
        });
        if (!shared) throw new ForbiddenException('Student is outside your assigned batches.');
        recipientIds = [shared.studentId];
      }
    } else if (dto.audience === 'BATCH') {
      if (!dto.batchId) throw new ForbiddenException('Select a batch.');
      if (senderRole === 'TEACHER') {
        const assignment = await this.prisma.teacherBatchAssignment.findFirst({where:{teacherId:senderId,batchId:dto.batchId,active:true}});
        if (!assignment) throw new ForbiddenException('You are not assigned to this batch.');
      }
      const students = await this.prisma.studentBatchEnrollment.findMany({where:{batchId:dto.batchId,active:true,student:{status:'ACTIVE',roles:{some:{role:{name:'STUDENT'}}}}},select:{studentId:true}});
      recipientIds = students.map(s=>s.studentId);
    } else if (dto.audience === 'ALL_STUDENTS') {
      if (senderRole !== 'ADMIN') throw new ForbiddenException('Only Admin can notify all students.');
      const users = await this.prisma.user.findMany({where:{status:'ACTIVE',roles:{some:{role:{name:'STUDENT'}}}},select:{id:true}});
      recipientIds = users.map(u=>u.id);
    } else if (dto.audience === 'ALL_TEACHERS') {
      if (senderRole !== 'ADMIN') throw new ForbiddenException('Only Admin can notify all teachers.');
      const users = await this.prisma.user.findMany({where:{status:'ACTIVE',roles:{some:{role:{name:'TEACHER'}}}},select:{id:true}});
      recipientIds = users.map(u=>u.id);
    }

    const uniqueIds = [...new Set(recipientIds)];
    if (!uniqueIds.length) return {message:'No eligible recipients found.',recipientCount:0};

    const channels: NotificationChannel[] = dto.channels?.length ? [...new Set(dto.channels)] : [NotificationChannel.IN_APP];
    return this.prisma.$transaction(async tx => {
      const notification = await tx.notification.create({
        data:{
          senderId, audience:dto.audience, batchId:dto.batchId, category:dto.category,
          subject:dto.subject, body:dto.body, deepLink:dto.deepLink,
          recipients:{create:uniqueIds.map(userId=>({userId}))},
          jobs:{create:channels.map(channel=>({channel}))},
        },
        select:{id:true,subject:true,category:true,createdAt:true},
      });
      await tx.auditLog.create({data:{actorUserId:senderId,action:'NOTIFICATION_CREATED',entityType:'Notification',entityId:notification.id,metadata:{audience:dto.audience,recipientCount:uniqueIds.length,channels}}});
      return {message:'Notification queued. Delivery requires configured channel workers.',notification,recipientCount:uniqueIds.length,channelsQueued:channels};
    });
  }

  getInbox(userId:string) {
    return this.prisma.notificationRecipient.findMany({
      where:{userId},orderBy:{createdAt:'desc'},take:100,
      select:{id:true,inAppStatus:true,readAt:true,createdAt:true,notification:{select:{id:true,subject:true,body:true,category:true,deepLink:true,createdAt:true}}},
    });
  }

  async markRead(recipientId:string,userId:string) {
    const record = await this.prisma.notificationRecipient.findFirst({where:{id:recipientId,userId}});
    if (!record) throw new NotFoundException('Notification not found.');
    return this.prisma.notificationRecipient.update({where:{id:recipientId},data:{inAppStatus:'READ',readAt:new Date()}});
  }

// System event helper: creates an in-app/email/push notification without pretending a human sent it.
  private async createSystemNotification(input:{
    recipientIds:string[]; subject:string; body:string; category:'CONTENT'|'PAYMENT';
    channels:Array<'IN_APP'|'EMAIL'|'SMS'|'PUSH'>; deepLink?:string;
  }) {
    const ids = [...new Set(input.recipientIds)];
    if (!ids.length) return {recipientCount:0};
    return this.prisma.notification.create({
      data:{
        senderId:null, audience:'INDIVIDUAL', category:input.category,
        subject:input.subject, body:input.body, deepLink:input.deepLink,
        recipients:{create:ids.map(userId=>({userId}))},
        jobs:{create:input.channels.map(channel=>({channel}))},
      },
      select:{id:true,subject:true,category:true,createdAt:true},
    });
  }

  // Call only after the material is published and access grants/enrolments are committed.
  async notifyNewContent(input:{batchId:string;title:string;deepLink?:string}) {
    const enrolled = await this.prisma.studentBatchEnrollment.findMany({
      where:{batchId:input.batchId,active:true,student:{status:'ACTIVE',roles:{some:{role:{name:'STUDENT'}}}}},
      select:{studentId:true},
    });
    const notification = await this.createSystemNotification({
      recipientIds:enrolled.map(x=>x.studentId),
      category:'CONTENT',subject:`New study material: ${input.title}`,
      body:`New study material is available for your assigned batch: ${input.title}.`,
      deepLink:input.deepLink,channels:['IN_APP','EMAIL','PUSH'],
    });
    return {notification,recipientCount:enrolled.length};
  }

  // Call only from a verified payment-webhook handler, never from a client success redirect.
  async notifyPaymentConfirmed(input:{
    studentId:string;paymentReference:string;amountLabel:string;adminIds:string[];
  }) {
    const studentNotification = await this.createSystemNotification({
      recipientIds:[input.studentId],category:'PAYMENT',subject:'Payment received',
      body:`We have confirmed your payment of ${input.amountLabel}. Reference: ${input.paymentReference}.`,
      channels:['IN_APP','EMAIL'],
    });
    const adminNotification = await this.createSystemNotification({
      recipientIds:input.adminIds,category:'PAYMENT',subject:'Student payment received',
      body:`A payment of ${input.amountLabel} was verified. Student payment reference: ${input.paymentReference}.`,
      channels:['IN_APP','EMAIL'],
    });
    return {studentNotification,adminNotification};
  }
}
