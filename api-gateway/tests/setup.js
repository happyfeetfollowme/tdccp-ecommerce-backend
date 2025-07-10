// Jest setup file
jest.setTimeout(15000);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Global teardown
afterAll(async () => {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Small delay to allow cleanup
  await new Promise(resolve => setTimeout(resolve, 50));
});
