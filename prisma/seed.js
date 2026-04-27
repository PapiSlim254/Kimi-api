const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create saccos
  const saccos = await Promise.all([
    prisma.sacco.create({
      data: { name: 'Westlands Boda Association', zone: 'Westlands', chairman: 'John Kamau' },
    }),
    prisma.sacco.create({
      data: { name: 'Kasarani Riders Sacco', zone: 'Kasarani', chairman: 'Peter Ochieng' },
    }),
    prisma.sacco.create({
      data: { name: 'CBD Express Riders', zone: 'CBD', chairman: 'Sarah Wanjiku' },
    }),
  ]);

  console.log(`Created ${saccos.length} saccos`);

  // Create test rider
  const riderPassword = await bcrypt.hash('password123', 12);
  const rider = await prisma.user.create({
    data: {
      phone: '254712345678',
      name: 'Test Rider',
      password: riderPassword,
    },
  });

  console.log('Created test rider:', rider.phone);

  // Create test driver (verified)
  const driverPassword = await bcrypt.hash('password123', 12);
  const driver = await prisma.driver.create({
    data: {
      phone: '254723456789',
      name: 'Test Driver',
      password: driverPassword,
      idNumber: '12345678',
      licenseNumber: 'DL123456',
      saccoId: saccos[0].id,
      isVerified: true,
      isOnline: true,
    },
  });

  // Set driver location (Westlands area)
  await prisma.driverLocation.create({
    data: {
      driverId: driver.id,
      lat: '-1.2684',
      lng: '36.8091',
    },
  });

  console.log('Created test driver:', driver.phone);

  // Create another driver (unverified)
  const unverifiedDriver = await prisma.driver.create({
    data: {
      phone: '254734567890',
      name: 'Unverified Driver',
      password: driverPassword,
      idNumber: '87654321',
      licenseNumber: 'DL654321',
      saccoId: saccos[1].id,
      isVerified: false,
      isOnline: false,
    },
  });

  console.log('Created unverified driver:', unverifiedDriver.phone);

  console.log('\nSeed completed successfully!');
  console.log('\nTest credentials:');
  console.log('Rider: 254712345678 / password123');
  console.log('Driver (verified): 254723456789 / password123');
  console.log('Driver (unverified): 254734567890 / password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
