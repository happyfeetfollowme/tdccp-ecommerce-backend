const request = require('supertest');

// Set test environment variables BEFORE any imports
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RABBITMQ_URL = 'amqp://localhost';
process.env.DATABASE_URL = 'file:./test.db';
process.env.PORT = '0';

// Define all constants needed by mocks first
const mockUserId = 'testUserId';
const mockAmqpPublish = jest.fn();
const mockAmqpChannel = {
    assertQueue: jest.fn(),
    publish: mockAmqpPublish,
    consume: jest.fn(),
};
const mockAmqpConnection = {
    createChannel: jest.fn().mockResolvedValue(mockAmqpChannel),
};

// Mock PrismaClient (though we'll use the prisma-db mock)
jest.mock('@prisma/client', () => {
    const mPrismaClient = {
        order: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        cart: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    };
    return { PrismaClient: jest.fn(() => mPrismaClient) };
});

// Mock the prisma-db module before importing the app
jest.mock('../../prisma-db/src', () => ({
  prisma: {
    cart: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
    },
  }
}));

// Get the mocked prisma instance from prisma-db
const { prisma } = require('../../prisma-db/src');

// Mock amqplib
jest.mock('amqplib', () => ({
    connect: jest.fn().mockResolvedValue(mockAmqpConnection),
}));

// Mock dotenv to prevent it from overriding our test environment
jest.mock('dotenv', () => ({
    config: jest.fn()
}));

// Mock the authenticateJWT middleware - must be mocked before any imports
jest.mock('../src/middleware/auth', () => ({
    authenticateJWT: jest.fn((req, res, next) => {
        // Set userId from header for easier testing
        req.userId = req.headers['x-user-id'] || mockUserId;
        if (req.headers['x-admin'] === 'true') {
            req.isAdmin = true;
        }
        next();
    })
}));

// Helper function to create mock database entities with timestamps
const createMockDbEntity = (baseData, includeTimestamps = true) => {
  const entity = { ...baseData };
  if (includeTimestamps) {
    entity.createdAt = new Date().toISOString();
    entity.updatedAt = new Date().toISOString();
  }
  return entity;
};

// Import the app AFTER all mocks are set up
const { app, server } = require('../src/index');

// Mock the global channel after app import to override the real RabbitMQ connection
const appModule = require('../src/index');
if (appModule.channel) {
    appModule.channel = mockAmqpChannel;
}

// Clean shutdown
afterAll(async () => {
    if (server && server.listening) {
        await new Promise(resolve => {
            server.close((err) => {
                if (err) console.error('Error closing server:', err);
                resolve();
            });
        });
    }
    // Force cleanup any remaining handles
    await new Promise(resolve => setTimeout(resolve, 100));
});

describe('Order Service API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Cart Management', () => {
        test('GET /api/cart - should return an existing cart', async () => {
            const mockCart = createMockDbEntity({ 
                id: 'cart1', 
                userId: mockUserId, 
                items: [] 
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);

            const res = await request(app).get('/api/cart').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'cart1',
                userId: mockUserId,
                items: []
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.cart.findUnique).toHaveBeenCalledWith({ where: { userId: mockUserId } });
        });

        test('GET /api/cart - should create a new cart if none exists', async () => {
            prisma.cart.findUnique.mockResolvedValue(null);
            const newCart = createMockDbEntity({ 
                id: 'newCart1', 
                userId: mockUserId, 
                items: [] 
            });
            prisma.cart.create.mockResolvedValue(newCart);

            const res = await request(app).get('/api/cart').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'newCart1',
                userId: mockUserId,
                items: []
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.cart.create).toHaveBeenCalledWith({ data: { userId: mockUserId, items: [] } });
        });

        test('POST /api/cart/items - should add a new item to cart', async () => {
            const mockCart = createMockDbEntity({ 
                id: 'cart1', 
                userId: mockUserId, 
                items: [] 
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);
            
            const updatedCart = createMockDbEntity({ 
                ...mockCart, 
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }] 
            });
            prisma.cart.update.mockResolvedValue(updatedCart);

            const res = await request(app)
                .post('/api/cart/items')
                .set('x-user-id', mockUserId)
                .send({ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'cart1',
                userId: mockUserId,
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }]
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.cart.update).toHaveBeenCalled();
        });

        test('POST /api/cart/items - should handle cart creation if cart does not exist', async () => {
            prisma.cart.findUnique.mockResolvedValue(null);
            const newCart = createMockDbEntity({ 
                id: 'newCart1', 
                userId: mockUserId, 
                items: [] 
            });
            prisma.cart.create.mockResolvedValue(newCart);
            
            const updatedCart = createMockDbEntity({ 
                ...newCart, 
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }] 
            });
            prisma.cart.update.mockResolvedValue(updatedCart);

            const res = await request(app)
                .post('/api/cart/items')
                .set('x-user-id', mockUserId)
                .send({ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'newCart1',
                userId: mockUserId,
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }]
            });
            expect(prisma.cart.create).toHaveBeenCalledWith({ data: { userId: mockUserId, items: [] } });
            expect(prisma.cart.update).toHaveBeenCalled();
        });

        test('PUT /api/cart/items/:id - should update item quantity', async () => {
            const mockCart = createMockDbEntity({ 
                id: 'cart1', 
                userId: mockUserId, 
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }] 
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);
            
            const updatedCart = createMockDbEntity({ 
                ...mockCart, 
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 5, walletAddress: 'wallet1' }] 
            });
            prisma.cart.update.mockResolvedValue(updatedCart);

            const res = await request(app)
                .put('/api/cart/items/prod1')
                .set('x-user-id', mockUserId)
                .send({ quantity: 5 });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'cart1',
                userId: mockUserId,
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 5, walletAddress: 'wallet1' }]
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.cart.update).toHaveBeenCalled();
        });

        test('PUT /api/cart/items/:id - should return 404 when cart not found', async () => {
            prisma.cart.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .put('/api/cart/items/prod1')
                .set('x-user-id', mockUserId)
                .send({ quantity: 5 });

            expect(res.statusCode).toEqual(404);
            expect(res.text).toContain('Cart not found');
        });

        test('PUT /api/cart/items/:id - should return 404 when item not found in cart', async () => {
            const mockCart = createMockDbEntity({ 
                id: 'cart1', 
                userId: mockUserId, 
                items: [{ productId: 'prod2', name: 'Product 2', price: 20, quantity: 1, walletAddress: 'wallet1' }] 
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);

            const res = await request(app)
                .put('/api/cart/items/prod1')
                .set('x-user-id', mockUserId)
                .send({ quantity: 5 });

            expect(res.statusCode).toEqual(404);
            expect(res.text).toContain('Item not found in cart');
        });

        test('DELETE /api/cart/items/:id - should remove an item from cart', async () => {
            const mockCart = createMockDbEntity({ 
                id: 'cart1', 
                userId: mockUserId, 
                items: [{ productId: 'prod1', name: 'Product 1', price: 10, quantity: 1, walletAddress: 'wallet1' }] 
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);
            
            const updatedCart = createMockDbEntity({ 
                ...mockCart, 
                items: [] 
            });
            prisma.cart.update.mockResolvedValue(updatedCart);

            const res = await request(app)
                .delete('/api/cart/items/prod1')
                .set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'cart1',
                userId: mockUserId,
                items: []
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.cart.update).toHaveBeenCalled();
        });

        test('DELETE /api/cart/items/:id - should return 404 when cart not found', async () => {
            prisma.cart.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .delete('/api/cart/items/prod1')
                .set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(404);
            expect(res.text).toContain('Cart not found');
        });
    });

    describe('Order Management', () => {
        test('POST /api/orders - should create orders from cart and clear cart', async () => {
            const mockCart = createMockDbEntity({
                id: 'cart1',
                userId: mockUserId,
                items: [
                    { productId: 'prod1', name: 'P1', price: 10, quantity: 1, walletAddress: 'walletA' },
                    { productId: 'prod2', name: 'P2', price: 20, quantity: 1, walletAddress: 'walletB' },
                ],
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);
            
            // Mock order creation to return orders with timestamps and unique IDs
            let orderIdCounter = 1;
            prisma.order.create.mockImplementation((params) => {
                const orderData = params.data;
                return Promise.resolve(createMockDbEntity({ 
                    id: `order${orderIdCounter++}`, 
                    ...orderData 
                }));
            });
            
            const clearedCart = createMockDbEntity({ ...mockCart, items: [] });
            prisma.cart.update.mockResolvedValue(clearedCart);

            const res = await request(app).post('/api/orders').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(201);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toEqual(2); // Two orders created
            expect(res.body[0]).toMatchObject({
                userId: mockUserId,
                status: 'PROCESSING'
            });
            expect(res.body[0].id).toBeDefined();
            expect(res.body[0].createdAt).toBeDefined();
            expect(res.body[0].updatedAt).toBeDefined();
            expect(res.body[0].total).toBeDefined();
            expect(prisma.order.create).toHaveBeenCalledTimes(2);
            expect(prisma.cart.update).toHaveBeenCalledWith({ where: { id: mockCart.id }, data: { items: [] } });
            expect(mockAmqpPublish).toHaveBeenCalledTimes(2);
        });

        test('POST /api/orders - should return 400 when cart is empty', async () => {
            const mockCart = createMockDbEntity({
                id: 'cart1',
                userId: mockUserId,
                items: []
            });
            prisma.cart.findUnique.mockResolvedValue(mockCart);

            const res = await request(app).post('/api/orders').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(400);
            expect(res.text).toContain('Cart is empty');
        });

        test('POST /api/orders - should return 400 when cart does not exist', async () => {
            prisma.cart.findUnique.mockResolvedValue(null);

            const res = await request(app).post('/api/orders').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(400);
            expect(res.text).toContain('Cart is empty');
        });

        test('GET /api/orders - should return user orders', async () => {
            const mockOrders = [
                createMockDbEntity({ id: 'order1', userId: mockUserId }),
                createMockDbEntity({ id: 'order2', userId: mockUserId })
            ];
            prisma.order.findMany.mockResolvedValue(mockOrders);

            const res = await request(app).get('/api/orders').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBe(2);
            expect(res.body[0]).toMatchObject({
                id: 'order1',
                userId: mockUserId
            });
            expect(res.body[0].createdAt).toBeDefined();
            expect(res.body[0].updatedAt).toBeDefined();
            expect(prisma.order.findMany).toHaveBeenCalledWith({ where: { userId: mockUserId } });
        });

        test('GET /api/orders/:id - should return a single order', async () => {
            const mockOrder = createMockDbEntity({ id: 'order1', userId: mockUserId });
            prisma.order.findUnique.mockResolvedValue(mockOrder);

            const res = await request(app).get('/api/orders/order1').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'order1',
                userId: mockUserId
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { id: 'order1', userId: mockUserId } });
        });

        test('GET /api/orders/:id - should return 404 when order not found', async () => {
            prisma.order.findUnique.mockResolvedValue(null);

            const res = await request(app).get('/api/orders/nonexistent').set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(404);
            expect(res.text).toContain('Order not found');
        });
    });

    describe('Admin Endpoints', () => {
        test('GET /api/admin/orders - should return all orders for admin', async () => {
            const mockOrders = [
                createMockDbEntity({ id: 'order1' }),
                createMockDbEntity({ id: 'order2' })
            ];
            prisma.order.findMany.mockResolvedValue(mockOrders);

            const res = await request(app)
                .get('/api/admin/orders')
                .set('x-user-id', mockUserId)
                .set('x-admin', 'true');

            expect(res.statusCode).toEqual(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBe(2);
            expect(res.body[0]).toMatchObject({ id: 'order1' });
            expect(res.body[0].createdAt).toBeDefined();
            expect(res.body[0].updatedAt).toBeDefined();
            expect(prisma.order.findMany).toHaveBeenCalledWith({
                orderBy: { createdAt: 'desc' }
            });
        });

        test('PUT /api/admin/orders/:id - should update order status and publish event', async () => {
            const mockOrder = createMockDbEntity({ id: 'order1', status: 'PROCESSING' });
            const updatedOrder = createMockDbEntity({ ...mockOrder, status: 'SHIPPED' });
            prisma.order.update.mockResolvedValue(updatedOrder);

            const res = await request(app)
                .put('/api/admin/orders/order1')
                .set('x-user-id', mockUserId)
                .set('x-admin', 'true')
                .send({ status: 'SHIPPED' });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'order1',
                status: 'SHIPPED'
            });
            expect(res.body.createdAt).toBeDefined();
            expect(res.body.updatedAt).toBeDefined();
            expect(prisma.order.update).toHaveBeenCalledWith({ 
                where: { id: 'order1' }, 
                data: { status: 'SHIPPED' } 
            });
            expect(mockAmqpPublish).toHaveBeenCalledWith(
                '', 'order_events', 
                Buffer.from(JSON.stringify({ 
                    eventName: 'OrderStatusUpdated', 
                    data: { orderId: 'order1', newStatus: 'SHIPPED' } 
                }))
            );
        });

        test('PUT /api/orders/:id - should allow user to cancel their own order', async () => {
            const mockOrder = createMockDbEntity({ 
                id: 'order1', 
                userId: mockUserId, 
                status: 'PROCESSING' 
            });
            prisma.order.findUnique.mockResolvedValue(mockOrder);
            
            const canceledOrder = createMockDbEntity({ 
                ...mockOrder, 
                status: 'CANCELED' 
            });
            prisma.order.update.mockResolvedValue(canceledOrder);

            const res = await request(app)
                .put('/api/orders/order1')
                .set('x-user-id', mockUserId)
                .send({ status: 'CANCELED' });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                id: 'order1',
                userId: mockUserId,
                status: 'CANCELED'
            });
            expect(prisma.order.update).toHaveBeenCalledWith({ 
                where: { id: 'order1' }, 
                data: { status: 'CANCELED' } 
            });
        });

        test('PUT /api/orders/:id - should return 400 for non-cancellation status change', async () => {
            const res = await request(app)
                .put('/api/orders/order1')
                .set('x-user-id', mockUserId)
                .send({ status: 'SHIPPED' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('Only cancellation is allowed');
        });

        test('PUT /api/orders/:id - should return 404 when order not found for user cancellation', async () => {
            prisma.order.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .put('/api/orders/order1')
                .set('x-user-id', mockUserId)
                .send({ status: 'CANCELED' });

            expect(res.statusCode).toEqual(404);
            expect(res.body.error).toContain('Order not found');
        });

        test('PUT /api/orders/:id - should return 400 when trying to cancel non-cancelable order', async () => {
            const mockOrder = createMockDbEntity({ 
                id: 'order1', 
                userId: mockUserId, 
                status: 'SHIPPED' 
            });
            prisma.order.findUnique.mockResolvedValue(mockOrder);

            const res = await request(app)
                .put('/api/orders/order1')
                .set('x-user-id', mockUserId)
                .send({ status: 'CANCELED' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('Order cannot be canceled in its current status');
        });
    });

    describe('Debug Endpoints', () => {
        test('GET /api/debug/user - should return current authenticated user', async () => {
            const res = await request(app)
                .get('/api/debug/user')
                .set('x-user-id', mockUserId);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toMatchObject({
                userId: mockUserId,
                message: 'Current authenticated user'
            });
        });
    });
});