// Imported first by helpers.ts so the environment is configured before the app (and database) load.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.EXPOSE_RESET_LINK = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
// Tests must never touch real services, whatever is in backend/.env (dotenv does not override these).
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.ADMIN_REGISTRATION_KEY = 'test-admin-registration-key-123';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitTestKey01';
process.env.RAZORPAY_KEY_SECRET = 'unit_test_key_secret_value';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit_test_webhook_secret';

export {};
