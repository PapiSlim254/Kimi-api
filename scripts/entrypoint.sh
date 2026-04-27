#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Checking if seed data is needed..."
USER_COUNT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count()
  .then(n => { process.stdout.write(String(n)); })
  .finally(() => p.\$disconnect());
")

if [ "$USER_COUNT" = "0" ]; then
  echo "Empty database — seeding test data..."
  node prisma/seed.js
else
  echo "Database already has data — skipping seed."
fi

echo "Starting server..."
exec node src/index.js
