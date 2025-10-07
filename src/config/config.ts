import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  databaseUrl: string;
}

const config: () => Config = () => ({
  port: Number(process.env.PORT ?? 3050),
  databaseUrl: process.env.DATABASE_URL || 'sqlite://dev.db',
});

export default config;
