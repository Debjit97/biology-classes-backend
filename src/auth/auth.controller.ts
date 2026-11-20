import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterTeacherDto } from './dto/register-teacher.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyAdminMfaDto } from './dto/verify-admin-mfa.dto';
import { ConfirmAdminMfaDto } from './dto/confirm-admin-mfa.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: string; roles: string[]; sessionId?: string; mfaSetupOnly?: boolean };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('teacher/register')
  registerTeacher(@Body() dto: RegisterTeacherDto) {
    return this.auth.registerTeacher(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/login/verify')
  verifyAdminMfa(@Body() dto: VerifyAdminMfaDto) {
    return this.auth.verifyAdminMfa(dto.challengeToken, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session/refresh')
  refreshSession(@Body() dto: RefreshSessionDto) {
    return this.auth.refreshSession(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('session/logout')
  logout(@Req() request: AuthenticatedRequest) {
    if (!request.user.sessionId) return { success: true };
    return this.auth.logout(request.user.sessionId, request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('session/logout-all')
  logoutAll(@Req() request: AuthenticatedRequest) {
    return this.auth.logoutAll(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('mfa/setup')
  startMfaSetup(@Req() request: AuthenticatedRequest) {
    return this.auth.startAdminMfaEnrollment(request.user.userId, !!request.user.mfaSetupOnly);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/setup/confirm')
  confirmMfaSetup(@Req() request: AuthenticatedRequest, @Body() dto: ConfirmAdminMfaDto) {
    return this.auth.confirmAdminMfaEnrollment(request.user.userId, !!request.user.mfaSetupOnly, dto.code);
  }
}
