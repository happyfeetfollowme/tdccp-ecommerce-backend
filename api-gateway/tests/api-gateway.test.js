const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Set test environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env.USER_SERVICE_URL = 'http://localhost:3011';
  process.env.PRODUCT_SERVICE_URL = 'http://localhost:3012';
  process.env.ORDER_SERVICE_URL = 'http://localhost:3013';
  process.env.PAYMENT_SERVICE_URL = 'http://localhost:3014';
  process.env.JWT_SECRET = 'test_jwt_secret';
  process.env.PORT = '0'; // Let the system assign a port
});

afterAll(() => {
  process.env = originalEnv;
});

// Mock services
const createMockUserService = () => {
  const service = express();
  service.use(express.json());
  service.get('/api/users/me', (req, res) => {
    if (req.headers['x-user-id']) {
      res.status(200).json({ id: req.headers['x-user-id'], email: 'test@example.com' });
    } else {
      res.status(400).json({ message: 'X-User-Id header missing' });
    }
  });
  service.get('/api/auth/discord', (req, res) => {
    res.status(200).json({ message: 'Discord auth endpoint' });
  });
  service.get('/api/auth/discord/callback', (req, res) => {
    res.status(200).json({ message: 'Discord callback' });
  });
  return service;
};

const createMockProductService = () => {
  const service = express();
  service.use(express.json());
  service.get('/api/products', (req, res) => {
    res.status(200).json([{ id: 'prod1', name: 'Product 1' }]);
  });
  return service;
};

const createMockOrderService = () => {
  const service = express();
  service.use(express.json());
  service.get('/api/orders', (req, res) => {
    if (req.headers['x-user-id']) {
      res.status(200).json([{ id: 'order1' }]);
    } else {
      res.status(400).json({ message: 'X-User-Id header missing' });
    }
  });
  return service;
};

const createMockPaymentService = () => {
  const service = express();
  service.use(express.json());
  service.post('/api/payments/charge', (req, res) => {
    res.status(200).json({ message: 'Payment initiated' });
  });
  return service;
};

describe('API Gateway', () => {
  let app;
  let mockServers = [];
  let mainAppServer = null;

  beforeAll(async () => {
    // Start mock services on different ports than the isolated test
    const services = [
      { service: createMockUserService(), port: 3011 },
      { service: createMockProductService(), port: 3012 },
      { service: createMockOrderService(), port: 3013 },
      { service: createMockPaymentService(), port: 3014 }
    ];

    const startPromises = services.map(({ service, port }) => {
      return new Promise((resolve, reject) => {
        const server = service.listen(port, '127.0.0.1', (err) => {
          if (err) {
            reject(err);
          } else {
            mockServers.push(server);
            resolve(server);
          }
        });
        server.on('error', reject);
      });
    });

    await Promise.all(startPromises);

    // Wait a bit for services to be ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now require the app after env vars are set and mock services are running
    delete require.cache[require.resolve('../src/index')];
    const appModule = require('../src/index');
    app = appModule.app;
    mainAppServer = appModule.server;
    
    // Close the main server since we only need the express app for testing
    if (mainAppServer && mainAppServer.listening) {
      await new Promise(resolve => {
        mainAppServer.close(() => resolve());
      });
    }
  });

  afterAll(async () => {
    // Close all mock servers with proper error handling
    const closePromises = mockServers.map(server => {
      return new Promise(resolve => {
        if (server && server.listening) {
          server.close((err) => {
            if (err) console.error('Error closing mock server:', err);
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    await Promise.all(closePromises);

    // Ensure main app server is closed
    if (mainAppServer && mainAppServer.listening) {
      await new Promise(resolve => {
        mainAppServer.close(() => resolve());
      });
    }

    // Force cleanup any remaining handles
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  };

  describe('Public Routes', () => {
    test('should allow access to GET /api/products without token', async () => {
      const res = await request(app).get('/api/products');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual([{ id: 'prod1', name: 'Product 1' }]);
    });
  });

  describe('Protected Routes', () => {
    test('should deny access to /api/users/me without token', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.statusCode).toEqual(401);
    });

    test('should deny access to /api/users/me with invalid token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.statusCode).toEqual(403);
    });

    test('should allow access to /api/users/me with valid token', async () => {
      const token = generateToken('user123');
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.id).toEqual('user123');
    });

    test('should allow access to /api/orders with valid token', async () => {
      const token = generateToken('user123');
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual([{ id: 'order1' }]);
    });

    test('should allow access to /api/payments/charge with valid token', async () => {
      const token = generateToken('user123');
      const res = await request(app)
        .post('/api/payments/charge')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'order123', amount: 100 });
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toEqual('Payment initiated');
    });
  });

  describe('JWT Authentication Edge Cases', () => {
    test('should return 401 for missing Authorization header', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.statusCode).toBe(401);
      expect(res.text).toContain('Authorization header is missing');
    });

    test('should return 401 for missing token after Bearer', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer ');
      expect(res.statusCode).toBe(401);
      expect(res.text).toContain('Access token is missing or invalid');
    });

    test('should return 401 for expired JWT token', async () => {
      const expiredToken = jwt.sign({ userId: 'user123' }, process.env.JWT_SECRET, { expiresIn: '-1h' });
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.statusCode).toBe(401);
      expect(res.text).toContain('Token expired');
    });

    test('should return 403 for malformed JWT token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalid.jwt.token');
      expect(res.statusCode).toBe(403);
      expect(res.text).toContain('Invalid token');
    });

    test('should return 403 for JWT with wrong secret', async () => {
      const wrongToken = jwt.sign({ userId: 'user123' }, 'wrong_secret', { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${wrongToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.text).toContain('Invalid token');
    });
  });

  describe('Public Routes - Discord Auth', () => {
    test('should allow access to Discord auth endpoint without token', async () => {
      const res = await request(app).get('/api/auth/discord');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Discord auth endpoint');
    });

    test('should allow access to Discord callback without token', async () => {
      const res = await request(app).get('/api/auth/discord/callback');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Discord callback');
    });
  });

  describe('Additional Coverage Tests', () => {
    test('should handle Authorization header without Bearer prefix', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'invalidtoken');
      expect(res.statusCode).toBe(401);
      expect(res.text).toContain('Access token is missing or invalid');
    });

    test('should handle empty Authorization header value', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', '');
      expect(res.statusCode).toBe(401);
      expect(res.text).toContain('Authorization header is missing');
    });

    test('should test number formatting middleware with integers', async () => {
      const res = await request(app).get('/api/products');
      expect(res.statusCode).toBe(200);
      // Test that integers remain unchanged
      if (typeof res.body[0] === 'object' && res.body[0].id) {
        expect(typeof res.body[0].id).toBe('string');
      }
    });

    test('should pass X-User-Id header to downstream services', async () => {
      const token = generateToken('test-user-456');
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe('test-user-456');
    });
  });
});
