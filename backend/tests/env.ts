// Imported first by helpers.ts so the environment is configured before the app (and database) load.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.EXPOSE_RESET_LINK = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '10000';

export {};
