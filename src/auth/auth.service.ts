import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { Prisma } from '../generated/prisma/client.js';
import { RefreshTokenStatus, UserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';

// Після стількох невдалих входів поспіль обліковий запис блокується на LOCK_MINUTES.
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

interface AccessTokenPayload {
  sub: string;
  email: string;
}

interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        status: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('User account is not active');
    }

    // Поки діє блокування, пароль навіть не перевіряється: підбирати його марно.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000),
      );

      throw new HttpException(
        `Забагато невдалих спроб входу. Спробуйте через ${minutes} хв`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      await this.registerFailedLogin(user.id);

      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    const accessToken = await this.createAccessToken(user.id, user.email);
    const { refreshToken } = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        roles: ['OWNER'],
        permissions: [] as string[],
      },
    };
  }

  // Лічильник збільшується в базі одним запитом, тому одночасні спроби не губляться.
  private async registerFailedLogin(userId: string) {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
        },
      });
    }
  }

  // Зміна власного пароля. Усі сесії закриваються, тому після неї треба увійти знову.
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException('User account is not active');
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!matches) {
      throw new BadRequestException('Поточний пароль неправильний');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'Новий пароль має відрізнятися від поточного',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, status: RefreshTokenStatus.ACTIVE },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  async refresh(refreshToken: string) {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.getRefreshSecret() },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = new Date();

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Блокуємо рядок сесії, щоб один токен не можна було використати двічі одночасно.
          const sessionRows = await tx.$queryRaw<
            Array<{
              id: string;
              user_id: string;
              token_hash: string;
              status: RefreshTokenStatus;
              revoked_at: Date | null;
              expires_at: Date;
            }>
          >`SELECT id, user_id, token_hash, status, revoked_at, expires_at FROM refresh_tokens WHERE id = ${payload.sessionId}::uuid FOR UPDATE`;

          const session = sessionRows[0];

          if (!session) {
            throw new UnauthorizedException('Invalid refresh token');
          }

          if (
            session.user_id !== payload.sub ||
            session.status !== RefreshTokenStatus.ACTIVE ||
            session.revoked_at !== null ||
            session.expires_at <= now
          ) {
            throw new UnauthorizedException(
              'Refresh token is expired or revoked',
            );
          }

          const tokenMatches = await bcrypt.compare(
            refreshToken,
            session.token_hash,
          );

          if (!tokenMatches) {
            throw new UnauthorizedException('Invalid refresh token');
          }

          const user = await tx.user.findFirst({
            where: { id: payload.sub, status: UserStatus.ACTIVE },
            select: { id: true, email: true },
          });

          if (!user) {
            throw new UnauthorizedException('User account is not active');
          }

          const accessToken = await this.createAccessToken(user.id, user.email);
          const { refreshToken: newRefreshToken } =
            await this.createRefreshToken(user.id, tx);

          await tx.refreshToken.update({
            where: { id: session.id },
            data: { status: RefreshTokenStatus.REVOKED, revokedAt: now },
          });

          return { accessToken, refreshToken: newRefreshToken };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new UnauthorizedException('Refresh token is already used');
      }

      throw error;
    }
  }

  async logout(refreshToken: string) {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.getRefreshSecret() },
      );
    } catch {
      return { success: true };
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        status: RefreshTokenStatus.ACTIVE,
      },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });

    return { success: true };
  }

  private createAccessToken(userId: string, email: string) {
    const payload: AccessTokenPayload = { sub: userId, email };

    return this.jwtService.signAsync(payload, {
      secret: this.getSecret('JWT_ACCESS_SECRET'),
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ??
        '15m') as JwtSignOptions['expiresIn'],
    });
  }

  private async createRefreshToken(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const sessionId = crypto.randomUUID();
    const payload: RefreshTokenPayload = { sub: userId, sessionId };

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.getRefreshSecret(),
      expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
        '7d') as JwtSignOptions['expiresIn'],
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await tx.refreshToken.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: await bcrypt.hash(refreshToken, 12),
        expiresAt,
        status: RefreshTokenStatus.ACTIVE,
      },
    });

    return { refreshToken, sessionId };
  }

  private getRefreshSecret() {
    return this.getSecret('JWT_REFRESH_SECRET');
  }

  private getSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET') {
    const secret = process.env[name];

    if (!secret) {
      throw new Error(`${name} is not configured`);
    }

    return secret;
  }
}
