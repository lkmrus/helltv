#!/bin/sh
set -e

echo "🐳 Docker entrypoint started"

# Check for initialization marker
if [ ! -f "/app/prisma/.initialized" ]; then
  echo "🚀 First run: initializing database"
  npx prisma migrate deploy
  npx prisma db seed
  # Create initialization marker
  touch /app/prisma/.initialized
  echo "✅ Database initialized with seed data"
else
  echo "📊 Database already initialized"
  echo "🔄 Running migrate deploy (pending migrations only)"
  npx prisma migrate deploy
fi

echo "🚀 Starting application..."
exec node dist/main.js
