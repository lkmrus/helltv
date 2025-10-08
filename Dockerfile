# syntax=docker/dockerfile:1

FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache libc6-compat openssl

# Copy package files
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Install all dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# Copy entrypoint script
COPY scripts/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Build application
RUN npm run build

# Expose port
EXPOSE 3050

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
