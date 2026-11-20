import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTeacherDto } from './dto/register-teacher.dto';
import {
  buildOtpAuthUri, decryptMfaSecret, encryptMfaSecret, generateTotpSecret, verifyTotp,
} from './mfa.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async registerTeacher(dto: RegisterTeacherDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Account already exists.');
    }
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    const role = await this.prisma.role.findUnique({ where: { name: 'TEACHER' } });
    if (!role) throw new Error('Missing seeded TEACHER role.');
    try {
      const user = await this.prisma.user.create({
        data: {
          email, passwordHash, displayName: dto.displayName.trim(), status: 'PENDING',
          roles: { create: [{ roleId: role.id }] }, teacherProfile: { create: {} },
          teacherApplication: { create: { status: 'PENDING' } },
        },
        select: { id: true, email: true, displayName: true, status: true },
      });
      return { message: 'Teacher application submitted for Admin approval.', user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Account already exists.');
      }
      throw error;
    }
  }

  async login(emailInput: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: emailInput.trim().toLowerCase() },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials or inactive account.');
    }

    const isAdmin = user.roles.some(item => item.role.name === 'ADMIN');
    if (isAdmin && user.mfaEnabled) {
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, ver: user.tokenVersion, purpose: 'admin_mfa_challenge' },
        { expiresIn: '5m' },
      );
      return { mfaRequired: true, challengeToken, expiresIn: '5m' };
    }
    if (isAdmin) {
      const setupToken = await this.jwt.signAsync(
        { sub: user.id, ver: user.tokenVersion, purpose: 'admin_mfa_setup' },
        { expiresIn: '10m' },
      );
      return {
        mfaSetupRequired: true,
        setupToken,
        instructions: 'Use this restricted token only to enrol and confirm an authenticator app. Admin functions remain blocked until MFA is enabled.',
        expiresIn: '10m',
      };
    }

    return this.completeLogin(user.id, user.tokenVersion);
  }

  async startAdminMfaEnrollment(userId: string, setupOnly: boolean) {
    if (!setupOnly) throw new ForbiddenException('Use the restricted Admin MFA setup session.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || !user.roles.some(item => item.role.name === 'ADMIN')) {
      throw new ForbiddenException('Active Admin account required.');
    }
    if (user.mfaEnabled) throw new ConflictException('Admin MFA is already enabled.');
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret, this.getMfaEncryptionKey());
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecretEnc: encrypted },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: userId, action: 'ADMIN_MFA_ENROLLMENT_STARTED', entityType: 'User', entityId: userId },
    });
    return {
      secret,
      otpauthUri: buildOtpAuthUri(user.email, secret),
      instructions: 'Add this account manually in an authenticator app, then confirm with the current six-digit code. This secret is shown only during setup.',
    };
  }

  async confirmAdminMfaEnrollment(userId: string, setupOnly: boolean, code: string) {
    if (!setupOnly) throw new ForbiddenException('Use the restricted Admin MFA setup session.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || user.mfaEnabled || !user.mfaPendingSecretEnc) {
      throw new BadRequestException('No pending Admin MFA enrollment was found.');
    }
    const secret = decryptMfaSecret(user.mfaPendingSecretEnc, this.getMfaEncryptionKey());
    const step = verifyTotp(secret, code);
    if (step === null) throw new UnauthorizedException('Invalid or expired authenticator code.');
    const changed = await this.prisma.user.updateMany({
      where: { id: userId, mfaEnabled: false, mfaPendingSecretEnc: user.mfaPendingSecretEnc },
      data: {
        mfaEnabled: true,
        mfaSecretEnc: user.mfaPendingSecretEnc,
        mfaPendingSecretEnc: null,
        mfaLastUsedStep: step,
        tokenVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ConflictException('MFA enrollment changed concurrently. Please sign in again.');
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { actorUserId: userId, action: 'ADMIN_MFA_ENABLED', entityType: 'User', entityId: userId },
      }),
    ]);
    return { success: true, message: 'Admin MFA is enabled. Sign in again and use your authenticator code.' };
  }

  async verifyAdminMfa(challengeToken: string, code: string) {
    let payload: { sub?: string; ver?: number; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken, {
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'biology-classes-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'biology-classes-clients',
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge.');
    }
    if (payload.purpose !== 'admin_mfa_challenge' || !payload.sub || !Number.isInteger(payload.ver)) {
      throw new UnauthorizedException('Invalid MFA challenge.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.ver || !user.mfaEnabled
      || !user.mfaSecretEnc || !user.roles.some(item => item.role.name === 'ADMIN')) {
      throw new UnauthorizedException('Admin MFA challenge is no longer valid.');
    }

    const secret = decryptMfaSecret(user.mfaSecretEnc, this.getMfaEncryptionKey());
    const step = verifyTotp(secret, code);
    if (step === null) throw new UnauthorizedException('Invalid or expired authenticator code.');

    const consumed = await this.prisma.user.updateMany({
      where: {
        id: user.id, mfaEnabled: true, tokenVersion: user.tokenVersion,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('Authenticator code has already been used.');

    return this.completeLogin(user.id, user.tokenVersion, true);
  }

  async refreshSession(refreshToken: string) {
    const parsed = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }

    const suppliedHash = this.hashRefreshToken(refreshToken);
    if (session.refreshTokenHash !== suppliedHash) {
      // A previously rotated token was replayed. Revoke the affected session.
      await this.prisma.$transaction([
        this.prisma.userSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: { actorUserId: session.userId, action: 'AUTH_REFRESH_REUSE_DETECTED', entityType: 'UserSession', entityId: session.id },
        }),
      ]);
      throw new UnauthorizedException('Refresh token reuse detected. Sign in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      await this.revokeSession(session.id, session.userId, 'AUTH_REFRESH_REJECTED_INACTIVE_USER');
      throw new UnauthorizedException('Account is inactive.');
    }

    const isAdmin = user.roles.some(item => item.role.name === 'ADMIN');
    if (isAdmin && !user.mfaEnabled) {
      await this.revokeSession(session.id, session.userId, 'AUTH_REFRESH_REJECTED_ADMIN_MFA');
      throw new UnauthorizedException('Admin MFA is required.');
    }

    const nextRefreshToken = this.newRefreshToken(session.id);
    const nextHash = this.hashRefreshToken(nextRefreshToken);
    const now = new Date();
    const rotated = await this.prisma.userSession.updateMany({
      where: { id: session.id, refreshTokenHash: suppliedHash, revokedAt: null, expiresAt: { gt: now } },
      data: { refreshTokenHash: nextHash, lastUsedAt: now },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('Refresh token has already been rotated.');

    const accessToken = await this.signAccessToken(user.id, user.tokenVersion, session.id, isAdmin);
    return {
      accessToken, refreshToken: nextRefreshToken, tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    };
  }

  async logout(sessionId: string, userId: string) {
    await this.revokeSession(sessionId, userId, 'AUTH_LOGOUT');
    return { success: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      this.prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { actorUserId: userId, action: 'AUTH_LOGOUT_ALL', entityType: 'User', entityId: userId },
      }),
    ]);
    return { success: true };
  }

  private async completeLogin(userId: string, tokenVersion: number, mfa = false) {
    const sessionId = randomUUID();
    const refreshToken = this.newRefreshToken(sessionId);
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const sessionDays = this.getSessionLifetimeDays();
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
    const accessToken = await this.signAccessToken(userId, tokenVersion, sessionId, mfa);
    await this.prisma.$transaction([
      this.prisma.userSession.create({
        data: { id: sessionId, userId, refreshTokenHash, expiresAt },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { actorUserId: userId, action: 'AUTH_LOGIN_SUCCEEDED', entityType: 'User', entityId: userId },
      }),
    ]);
    return {
      accessToken, refreshToken, tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      refreshExpiresAt: expiresAt.toISOString(),
    };
  }

  private async signAccessToken(userId: string, tokenVersion: number, sessionId: string, mfa: boolean) {
    return this.jwt.signAsync({
      sub: userId, ver: tokenVersion, sid: sessionId,
      ...(mfa ? { amr: ['pwd', 'mfa'] } : {}),
    });
  }

  private newRefreshToken(sessionId: string) {
    return `${sessionId}.${randomBytes(48).toString('base64url')}`;
  }

  private parseRefreshToken(token: string): { sessionId: string } {
    const [sessionId, secret, extra] = token.split('.');
    if (!sessionId || !secret || extra !== undefined || !/^[0-9a-f-]{36}$/i.test(sessionId)
      || !/^[A-Za-z0-9_-]{64}$/.test(secret)) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    return { sessionId };
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async revokeSession(sessionId: string, userId: string, action: string) {
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: { actorUserId: userId, action, entityType: 'UserSession', entityId: sessionId },
      }),
    ]);
  }

  private getSessionLifetimeDays() {
    const value = Number(this.config.get<string>('REFRESH_SESSION_DAYS') ?? '30');
    if (!Number.isInteger(value) || value < 1 || value > 90) {
      throw new Error('REFRESH_SESSION_DAYS must be an integer between 1 and 90.');
    }
    return value;
  }

  private getMfaEncryptionKey(): string {
    const key = this.config.get<string>('MFA_ENCRYPTION_KEY');
    if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
      throw new Error('MFA_ENCRYPTION_KEY must be configured as 64 hexadecimal characters (32 random bytes).');
    }
    return key;
  }
}
