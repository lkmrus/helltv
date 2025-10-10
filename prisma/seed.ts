import { PrismaClient, UserRole } from '@prisma/client';

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

  // Create Accounts
  // Service account: unlimited balance (external source, no transaction history needed)
  // User account: starts with $0 - use CREDIT API to add funds
  const serviceAccount = await prisma.account.create({
    data: {
      userId: serviceUser.id,
      currency: 'USD',
      balance: 1000000.0,
      incoming: 0,
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
  console.log('📝 Service account (id=1): $1,000,000 (unlimited)');
  console.log(
    '📝 User account (id=2): $0 - use POST /accounts/user/2/credit to add funds',
  );
  console.log('📝 Product (id=1): $100');
  console.log('');
  console.log('Example: POST /accounts/user/2/credit { "amount": 500 }');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
