// Test setup file for Order Service
const originalEnv = process.env;

beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.RABBITMQ_URL = 'amqp://localhost';
  process.env.DATABASE_URL = 'file:./test.db';
  process.env.PORT = '0'; // Let system assign port
  
  // Suppress console output during tests unless explicitly needed
  if (!process.env.VERBOSE_TESTS) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterAll(() => {
  // Restore original environment
  process.env = originalEnv;
  
  // Restore console methods
  if (console.log.mockRestore) {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  }
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// Global test utilities
global.createMockDbEntity = (baseData, includeTimestamps = true) => {
  const entity = { ...baseData };
  if (includeTimestamps) {
    entity.createdAt = new Date().toISOString();
    entity.updatedAt = new Date().toISOString();
  }
  return entity;
};
