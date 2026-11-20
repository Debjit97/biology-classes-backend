import { PrismaClient, RoleName } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  for (const name of Object.values(RoleName)) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'System Administrator';

  // Role seeding is repeatable. Admin creation is explicit and uses a one-time secret.
  if (!email && !password) {
    console.log('Roles seeded. No bootstrap Admin requested.');
    return;
  }
  if (!email || !password || password.length < 16 || !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and a 16+ character password containing upper/lowercase letters, a number and a symbol.');
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  if (existing) {
    const isAlreadyAdmin = existing.roles.some(item => item.role.name === 'ADMIN');
    if (!isAlreadyAdmin || existing.status !== 'ACTIVE') {
      throw new Error(
        'Bootstrap refused: the configured email already belongs to a non-Admin or inactive account. ' +
        'Use a new, dedicated Admin email; this script will never promote or reactivate an existing account.',
      );
    }
    console.log('The configured account is already an active Admin. No account changes were made.');
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
  });
  await prisma.user.create({
    data: {
      email, displayName, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: [{ roleId: adminRole.id }] },
    },
    select: { id: true },
  });

  console.log(`A new bootstrap Admin was created for ${email}. Remove bootstrap credentials from the environment immediately.`);
}

main()
  .catch(error => {
    console.error('Database seed failed.');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
