import {
  PrismaClient,
  UserRole,
  TransactionType,
  TransactionState,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Clear existing data (for development)
  await prisma.order.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  console.log('✅ Cleared existing data');

  // Create Users
  const serviceUser = await prisma.user.create({
    data: {
      id: 1,
      email: 'service@helltv.store',
      role: UserRole.SERVICE,
    },
  });

  const regularUser = await prisma.user.create({
    data: {
      id: 2,
      email: 'user@helltv.store',
      role: UserRole.USER,
    },
  });

  console.log(
    `✅ Created users: SERVICE (id=${serviceUser.id}), USER (id=${regularUser.id})`,
  );

  // Create Accounts with zero balance (will be filled via transactions)
  const serviceAccount = await prisma.account.create({
    data: {
      userId: serviceUser.id,
      currency: 'USD',
      balance: 10000.0,
      incoming: 10000.0,
      outgoing: 0,
    },
  });

  const userAccount = await prisma.account.create({
    data: {
      userId: regularUser.id,
      currency: 'USD',
      balance: 0,
      incoming: 0,
      outgoing: 0,
    },
  });

  console.log(
    `✅ Created accounts: service balance=$${serviceAccount.balance.toNumber()}, user balance=$${userAccount.balance.toNumber()}`,
  );

  // Create initial CREDIT transaction for service account (external source)
  // This represents the initial funding of the platform
  await prisma.transaction.create({
    data: {
      type: TransactionType.CREDIT,
      state: TransactionState.COMPLETED,
      accountAId: serviceAccount.id, // from nowhere (external)
      accountBId: serviceAccount.id, // to service account
      amountOut: 10000.0,
      amountIn: 10000.0,
      currency: 'USD',
      meta: JSON.stringify({}),
      completedAt: new Date(),
    },
  });

  console.log('✅ Created initial funding transaction for service account');

  // Create Product
  const product = await prisma.product.create({
    data: {
      id: 1,
      title: 'Sample Product #1',
      price: 100.0,
      active: true,
    },
  });

  console.log(
    `✅ Created product: "${product.title}" (id=${product.id}, price=$${product.price.toNumber()})`,
  );

  console.log('🎉 Seed completed successfully!');
  console.log(
    '📝 Note: User account (id=2) starts with $0 balance. Use CREDIT endpoint to add funds.',
  );
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
