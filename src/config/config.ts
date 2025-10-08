import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
  };
}

const config: () => Config = () => ({
  port: Number(process.env.PORT ?? 3050),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/billing?schema=public&sslmode=disable',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
});

export default config;
