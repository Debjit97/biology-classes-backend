import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

interface AccessPayload {
  sub: string;
  ver?: number;
  sid?: string;
  purpose?: string;
  amr?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be configured with at least 32 characters.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
      issuer: config.get<string>('JWT_ISSUER') ?? 'biology-classes-api',
      audience: config.get<string>('JWT_AUDIENCE') ?? 'biology-classes-clients',
    });
  }

  async validate(payload: AccessPayload) {
    if (!payload?.sub || !Number.isInteger(payload.ver)) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        status: true, tokenVersion: true, mfaEnabled: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const roles = user.roles.map(item => item.role.name);
    const isAdmin = roles.includes('ADMIN');
    if (payload.purpose === 'admin_mfa_setup') {
      if (!isAdmin || user.mfaEnabled || payload.sid) {
        throw new UnauthorizedException('Admin MFA setup session is no longer valid.');
      }
      return { userId: payload.sub, roles: [], mfaSetupOnly: true };
    }
    if (payload.purpose || !payload.sid) throw new UnauthorizedException('This token cannot access protected resources.');

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt
      || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session has expired or been revoked.');
    }
    if (isAdmin && (!user.mfaEnabled || !payload.amr?.includes('mfa'))) {
      throw new UnauthorizedException('Admin MFA is required before accessing protected resources.');
    }
    return { userId: payload.sub, roles, sessionId: payload.sid };
  }
}
