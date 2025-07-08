console.log('Running product-service.test.js');

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

// Constants for amqplib mock
const mockAmqpChannelAck = jest.fn();
const mockAmqpChannelNack = jest.fn();
let capturedConsumeCallback; // To capture and manually trigger consume callback

// Mock PrismaClient
jest.mock('@prisma/client', () => {
    const mPrismaClient = {
        product: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(), // Mock the count method
        },
    };
    return { PrismaClient: jest.fn(() => mPrismaClient) };
});

// Mock amqplib
jest.mock('amqplib', () => ({
    connect: jest.fn().mockResolvedValue({
        createChannel: jest.fn().mockResolvedValue({
            assertQueue: jest.fn().mockResolvedValue(undefined),
            publish: jest.fn(),
            consume: jest.fn((queue, callback) => {
                capturedConsumeCallback = callback;
            }),
            ack: mockAmqpChannelAck,
            nack: mockAmqpChannelNack,
        }),
    }),
}));

// Mock Supabase
const mockSupabaseClient = {
    storage: {
        from: jest.fn().mockReturnThis(),
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn(filePath => ({
            data: { publicUrl: `https://mock-bucket.supabase.co/images/${filePath}` }
        })),
        remove: jest.fn().mockResolvedValue({ error: null }),
    },
};
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => mockSupabaseClient),
}));


// Mock Auth Middleware
jest.mock('../src/middleware/auth', () => ({
    authenticateJWT: jest.fn((req, res, next) => {
        req.isAdmin = req.headers['x-admin'] === 'true';
        next();
    })
}));

const prisma = new PrismaClient();

// Import the actual app after mocks are set up
const { app, server } = require('../src/index');

// This code runs once after all tests in this file are done.
afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

describe('Product Service API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAmqpChannelAck.mockClear();
        mockAmqpChannelNack.mockClear();
    });

    describe('GET /api/products', () => {
        test('should return a list of products', async () => {
            const mockProducts = [{ id: 'prod1', name: 'Product 1' }];
            prisma.product.findMany.mockResolvedValue(mockProducts);
            prisma.product.count.mockResolvedValue(mockProducts.length);

            const res = await request(app).get('/api/products');

            expect(res.statusCode).toEqual(200);
            expect(res.body.products).toEqual(mockProducts);
            expect(prisma.product.findMany).toHaveBeenCalledWith({
                where: {},
                orderBy: {},
                skip: 0,
                take: 10,
            });
        });

        test('should filter products by search term', async () => {
            prisma.product.findMany.mockResolvedValue([]);
            prisma.product.count.mockResolvedValue(0);
            await request(app).get('/api/products?search=Product');
            expect(prisma.product.findMany).toHaveBeenCalledWith({
                where: {
                    OR: [
                        { name: { contains: 'Product', mode: 'insensitive' } },
                        { description: { contains: 'Product', mode: 'insensitive' } },
                    ],
                },
                orderBy: {},
                skip: 0,
                take: 10,
            });
        });

        test('should sort products', async () => {
            prisma.product.findMany.mockResolvedValue([]);
            prisma.product.count.mockResolvedValue(0);
            await request(app).get('/api/products?sortBy=price&order=desc');
            expect(prisma.product.findMany).toHaveBeenCalledWith({
                where: {},
                orderBy: { price: 'desc' },
                skip: 0,
                take: 10,
            });
        });
    });

    describe('GET /api/products/:id', () => {
        test('should return a single product by ID', async () => {
            const mockProduct = { id: 'prod1', name: 'Product 1' };
            prisma.product.findUnique.mockResolvedValue(mockProduct);

            const res = await request(app).get('/api/products/prod1');

            expect(res.statusCode).toEqual(200);
            expect(res.body).toEqual(mockProduct);
        });

        test('should return 404 if product not found', async () => {
            prisma.product.findUnique.mockResolvedValue(null);
            const res = await request(app).get('/api/products/nonexistent');
            expect(res.statusCode).toEqual(404);
        });
    });

    describe('POST /api/products', () => {
        test('should create a new product if admin', async () => {
            const newProductData = { name: 'New Product', description: 'Desc', price: 10, imageUrl: 'url', walletAddress: 'addr', stock: 5 };
            prisma.product.create.mockResolvedValue({ id: 'newProdId', ...newProductData });

            const res = await request(app)
                .post('/api/products')
                .set('x-admin', 'true')
                .send(newProductData);

            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('id', 'newProdId');
        });

        test('should return 403 if not admin', async () => {
            const res = await request(app).post('/api/products').send({});
            expect(res.statusCode).toEqual(403);
        });
    });

    describe('PUT /api/products/:id', () => {
        test('should update an existing product if admin', async () => {
            const updatedProductData = { name: 'Updated Product' };
            prisma.product.update.mockResolvedValue({ id: 'prod1', ...updatedProductData });

            const res = await request(app)
                .put('/api/products/prod1')
                .set('x-admin', 'true')
                .send(updatedProductData);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('id', 'prod1');
        });

        test('should return 403 if not admin', async () => {
            const res = await request(app).put('/api/products/prod1').send({});
            expect(res.statusCode).toEqual(403);
        });
    });

    describe('DELETE /api/products/:id', () => {
        test('should delete a product if admin', async () => {
            prisma.product.delete.mockResolvedValue({});
            const res = await request(app)
                .delete('/api/products/prod1')
                .set('x-admin', 'true');
            expect(res.statusCode).toEqual(204);
        });

        test('should return 403 if not admin', async () => {
            const res = await request(app).delete('/api/products/prod1');
            expect(res.statusCode).toEqual(403);
        });
    });

    describe('RabbitMQ Event Consumption', () => {
        const flushPromises = () => new Promise(setImmediate);

        test('should decrement stock and increment preservedStock on OrderCreated event', async () => {
            await flushPromises();
            if (!capturedConsumeCallback) throw new Error("Consume callback not captured");

            const msg = {
                content: Buffer.from(JSON.stringify({
                    eventName: 'OrderCreated',
                    data: { items: [{ productId: 'prod1', quantity: 2 }] }
                })),
                fields: { deliveryTag: 1 }
            };
            await capturedConsumeCallback(msg);
            await flushPromises();

            expect(prisma.product.update).toHaveBeenCalledWith({
                where: { id: 'prod1' },
                data: {
                    stock: { decrement: 2 },
                    preservedStock: { increment: 2 }
                }
            });
            expect(mockAmqpChannelAck).toHaveBeenCalledWith(msg);
        });

        test('should decrement preservedStock on OrderPaid event', async () => {
            await flushPromises();
            if (!capturedConsumeCallback) throw new Error("Consume callback not captured for OrderPaid test");

            const msg = {
                content: Buffer.from(JSON.stringify({
                    eventName: 'OrderPaid',
                    data: { orderId: 'order1', items: [{ productId: 'prod1', quantity: 2 }] }
                })),
                fields: { deliveryTag: 2 }
            };
            await capturedConsumeCallback(msg);
            await flushPromises();

            expect(prisma.product.update).toHaveBeenCalledWith({
                where: { id: 'prod1' },
                data: {
                    preservedStock: { decrement: 2 }
                }
            });
            expect(mockAmqpChannelAck).toHaveBeenCalledWith(msg);
        });

        test('should increment stock and decrement preservedStock on OrderCanceled event', async () => {
            await flushPromises();
            if (!capturedConsumeCallback) throw new Error("Consume callback not captured for OrderCanceled test");

            const msg = {
                content: Buffer.from(JSON.stringify({
                    eventName: 'OrderCanceled',
                    data: { orderId: 'order1', items: [{ productId: 'prod1', quantity: 2 }] }
                })),
                fields: { deliveryTag: 3 }
            };
            await capturedConsumeCallback(msg);
            await flushPromises();

            expect(prisma.product.update).toHaveBeenCalledWith({
                where: { id: 'prod1' },
                data: {
                    stock: { increment: 2 },
                    preservedStock: { decrement: 2 }
                }
            });
            expect(mockAmqpChannelAck).toHaveBeenCalledWith(msg);
        });
    });

    describe('Product Image Upload API', () => {
        it('should create a product with images', async () => {
            const newProductData = {
                name: 'Test Product',
                description: 'desc',
                price: 10.5,
                walletAddress: 'wallet',
                stock: 5,
            };
            // The actual URL will be generated by the Supabase mock
            const expectedImages = ['https://mock-bucket.supabase.co/images/test-image.png'];
            prisma.product.create.mockResolvedValue({ id: 'newProdId', ...newProductData, images: expectedImages });

            const imagePath = require('path').join(__dirname, 'test-image.png');
            require('fs').writeFileSync(imagePath, 'fake-image-data');

            const res = await request(app)
                .post('/api/products')
                .set('x-admin', 'true')
                .field('name', 'Test Product')
                .field('description', 'desc')
                .field('price', '10.5')
                .field('walletAddress', 'wallet')
                .field('stock', '5')
                .attach('images', imagePath, 'test-image.png');

            require('fs').unlinkSync(imagePath);

            expect(res.statusCode).toBe(201);
            expect(res.body.images[0]).toContain('https://mock-bucket.supabase.co/images');
            expect(prisma.product.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    name: 'Test Product',
                    images: expect.any(Array),
                })
            });
        });

        it('should update a product and replace images', async () => {
            const productId = 'prod123';
            const originalProduct = {
                id: productId,
                name: 'Test Product 2',
                images: ['https://mock-bucket.supabase.co/images/old-image.png']
            };
            const updatedProductData = {
                id: productId,
                name: 'Test Product 2 Updated',
                images: ['https://mock-bucket.supabase.co/images/new-image.png']
            };

            prisma.product.findUnique.mockResolvedValue(originalProduct);
            prisma.product.update.mockResolvedValue(updatedProductData);

            const imagePath = require('path').join(__dirname, 'test-image2.png');
            require('fs').writeFileSync(imagePath, 'fake-image-data-2');

            const res = await request(app)
                .put(`/api/products/${productId}`)
                .set('x-admin', 'true')
                .field('name', 'Test Product 2 Updated')
                .attach('images', imagePath, 'new-image.png');

            require('fs').unlinkSync(imagePath);

            expect(res.statusCode).toBe(200);
            expect(res.body.name).toBe('Test Product 2 Updated');
            expect(res.body.images[0]).toContain('https://mock-bucket.supabase.co/images/new-image.png');

            // Verify that the old image was deleted
            expect(mockSupabaseClient.storage.remove).toHaveBeenCalledWith(['old-image.png']);
            
            // Verify that prisma update was called correctly
            expect(prisma.product.update).toHaveBeenCalledWith({
                where: { id: productId },
                data: expect.objectContaining({
                    name: 'Test Product 2 Updated',
                    images: expect.any(Array),
                })
            });
        });
    });
});
