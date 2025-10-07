# syntax=docker/dockerfile:1

# Install dependencies shared across stages
FROM node:20-alpine AS base
WORKDIR /usr/src/app
ENV CI=true
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Build the application
FROM base AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY supabase ./supabase
RUN npm run build

# Install only production dependencies
FROM node:20-alpine AS production-deps
WORKDIR /usr/src/app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# Runtime image
FROM node:20-alpine AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl

COPY --from=production-deps /usr/src/app/node_modules ./node_modules
COPY --from=production-deps /usr/src/app/package.json ./
COPY --from=production-deps /usr/src/app/package-lock.json ./
COPY --from=production-deps /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const req=require('http').request({method:'HEAD',host:'127.0.0.1',port:3000,path:'/'},res=>process.exit(res.statusCode<500?0:1));req.on('error',()=>process.exit(1));req.end()"

CMD ["node", "dist/main.js"]
