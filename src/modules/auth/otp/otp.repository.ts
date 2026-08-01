import { PrismaClient, OtpRecord, OtpPurpose } from '@prisma/client';
import { Result } from '../../../shared/result.js';

export class OtpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(data: {
    email: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<Result<OtpRecord, Error>> {
    try {
      // Invalidate existing OTPs for the same email + purpose first
      await this.prisma.otpRecord.deleteMany({
        where: { email: data.email, purpose: data.purpose },
      });

      const record = await this.prisma.otpRecord.create({ data });
      return Result.ok(record);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async findActive(email: string, purpose: OtpPurpose): Promise<Result<OtpRecord | null, Error>> {
    try {
      const record = await this.prisma.otpRecord.findFirst({
        where: {
          email,
          purpose,
          expiresAt: { gt: new Date() },
        },
        // save() clears prior records for the same email+purpose, but concurrent
        // requests can still leave two live rows. Without an explicit order
        // Postgres may return either, and the user would be checked against a
        // code they were never sent.
        orderBy: { createdAt: 'desc' },
      });
      return Result.ok(record);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async incrementAttempts(id: string): Promise<Result<OtpRecord, Error>> {
    try {
      const record = await this.prisma.otpRecord.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      return Result.ok(record);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async delete(id: string): Promise<Result<void, Error>> {
    try {
      await this.prisma.otpRecord.delete({ where: { id } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error as Error);
    }
  }
}
