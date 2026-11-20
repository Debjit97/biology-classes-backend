import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
export class CreateNotificationDto {
  @IsIn(['INDIVIDUAL','BATCH','ALL_STUDENTS','ALL_TEACHERS'])
  audience!: 'INDIVIDUAL'|'BATCH'|'ALL_STUDENTS'|'ALL_TEACHERS';
  @IsOptional() @IsUUID() targetUserId?: string;
  @IsOptional() @IsUUID() batchId?: string;
  @IsIn(['CONTENT','PAYMENT','EXAMINATION','LIVE_CLASS','GENERAL','SYSTEM'])
  category!: 'CONTENT'|'PAYMENT'|'EXAMINATION'|'LIVE_CLASS'|'GENERAL'|'SYSTEM';
  @IsString() @MinLength(2) @MaxLength(160) subject!: string;
  @IsString() @MinLength(2) @MaxLength(3000) body!: string;
  @IsOptional() @IsString() @MaxLength(500) deepLink?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4)
  @IsIn(['IN_APP','EMAIL','SMS','PUSH'], { each: true })
  channels?: Array<'IN_APP'|'EMAIL'|'SMS'|'PUSH'>;
}
