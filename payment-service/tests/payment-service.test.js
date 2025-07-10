const request = require('supertest');
// express is not directly used in the test file, so it can be removed if not needed for type inference by some tools.
// const express = require('express');
const { PrismaClient } = require('@prisma/client'); // Required for 'new PrismaClient()'

// 1. Define ALL variables that will be used by ANY jest.mock factory
const mockAmqpPublish = jest.fn();
const mockAmqpChannel = {
    assertQueue: jest.fn(),
    publish: mockAmqpPublish,
    consume: jest.fn(),
};
const mockAmqpConnection = {
    createChannel: jest.fn().mockResolvedValue(mockAmqpChannel),
};

// Define the mock Prisma operations that payment-service will use
const mockPrismaOps = {
    payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    // Add other models here if payment-service interacts with them
    // e.g., order: { findUnique: jest.fn() },
};

// 2. ALL jest.mock calls
// Mock the shared prisma-db module
jest.mock('../../prisma-db/src', () => ({
    prisma: mockPrismaOps
}));

// No longer need to mock @prisma/client directly here if prisma-db is fully mocked
// jest.mock('@prisma/client', () => { ... });

jest.mock('amqplib', () => ({ // This uses mockAmqpConnection
    connect: jest.fn().mockResolvedValue(mockAmqpConnection),
}));

jest.mock('@solana/web3.js', () => {
    // const actualWeb3 = jest.requireActual('@solana/web3.js'); // Not using for BN anymore
    return {
        Connection: jest.fn(() => ({})),
        PublicKey: jest.fn((key) => ({
            toString: () => String(key),
            equals: (other) => other.toString() === String(key)
        })),
        Keypair: jest.fn(() => ({
            publicKey: {
                toString: () => 'mockReferencePublicKey',
                equals: (other) => other.toString() === 'mockReferencePublicKey'
            },
        })),
        Transaction: jest.fn(),
        BN: jest.fn(function(val) { // A simple constructor mock for BN
            this.value = val;
            // this.toNumber = () => parseInt(val.toString()); // Example if needed
        }),
    };
});

jest.mock('@solana/pay', () => ({
    createQR: jest.fn(),
    encodeURL: jest.fn(() => ({ toString: () => 'mockSolanaPayUrl' })),
    findReference: jest.fn(),
    validateTransfer: jest.fn(),
    FindReferenceError: class FindReferenceError extends Error { constructor() { super("FindReferenceError"); this.name = "FindReferenceError";}},
    ValidateTransferError: class ValidateTransferError extends Error { constructor() { super("ValidateTransferError"); this.name = "ValidateTransferError";}},
}));
const solanaPay = require('@solana/pay'); // Import the mocked module

// Mock dotenv to prevent it from overriding our test environment
jest.mock('dotenv', () => ({
    config: jest.fn()
}));

// The application itself will get 'prisma' from the mocked '../../prisma-db/src'.
// Tests will use 'mockPrismaOps' directly to set up mockResolvedValue etc.
// const prisma = new PrismaClient(); // OLD LINE - REMOVED

// Mock environment variables - Placed before app import
process.env.SOLANA_RPC_URL = 'http://mock-solana-rpc';
process.env.SHOP_WALLET_ADDRESS = 'mockShopWalletAddress';
process.env.RABBITMQ_URL = 'amqp://localhost';

// Import the actual app after mocks are set up
const { app, server } = require('../src/index');

// This code runs once after all tests in this file are done.
afterAll(async () => {
    // We need to wait for the server to close before Jest can exit.
    await new Promise(resolve => server.close(resolve));
});

describe('Payment Service API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/payments/charge', () => {
        test('should initiate a payment and return Solana Pay URL', async () => {
            const mockPaymentData = { id: 'payment123', orderId: 'order1', amount: 100, status: 'PENDING' };
            mockPrismaOps.payment.create.mockResolvedValue(mockPaymentData);

            // Ensure Keypair mock is fresh if it's called multiple times across tests or setup
            // For this test, it's called once inside the route handler.

            const res = await request(app)
                .post('/api/payments/charge')
                .send({ orderId: 'order1', amount: 100, recipientWallet: 'mockRecipientWallet' });

            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('paymentId', 'payment123');
            expect(res.body).toHaveProperty('solanaPayUrl', 'mockSolanaPayUrl');
            expect(res.body).toHaveProperty('reference', 'mockReferencePublicKey'); // From Keypair mock
            expect(mockPrismaOps.payment.create).toHaveBeenCalledWith({
                data: {
                    orderId: 'order1',
                    amount: 100,
                    status: 'PENDING',
                    transaction: null,
                },
            });
            expect(solanaPay.encodeURL).toHaveBeenCalled();
        });

        test('should return 400 if required fields are missing', async () => {
            const res = await request(app).post('/api/payments/charge').send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body).toHaveProperty('error', 'Missing orderId, amount, or recipientWallet');
        });
    });

    describe('GET /api/payments/verify', () => {
        test('should verify a payment and update status to COMPLETED', async () => {
            const mockPayment = { id: 'payment123', orderId: 'order1', amount: 100, status: 'PENDING' };
            const updatedPayment = { ...mockPayment, status: 'COMPLETED', transaction: 'mockSignature' };

            mockPrismaOps.payment.findUnique.mockResolvedValue(mockPayment);
            // Ensure PublicKey mock handles being called with 'mockReference' and 'mockShopWalletAddress'
            solanaPay.findReference.mockResolvedValue({ signature: 'mockSignature' });
            solanaPay.validateTransfer.mockResolvedValue(true); // Assuming validateTransfer resolves if successful
            mockPrismaOps.payment.update.mockResolvedValue(updatedPayment);

            const res = await request(app)
                .get('/api/payments/verify?reference=mockReference&paymentId=payment123');

            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('status', 'COMPLETED');
            expect(res.body).toHaveProperty('transaction', 'mockSignature');
            expect(mockPrismaOps.payment.update).toHaveBeenCalledWith({
                where: { id: 'payment123' },
                data: { status: 'COMPLETED', transaction: 'mockSignature' },
            });
            expect(mockAmqpPublish).toHaveBeenCalledWith(
                '', 'order_events', Buffer.from(JSON.stringify({ eventName: 'OrderPaid', data: { orderId: 'order1', paymentId: 'payment123', transaction: 'mockSignature' } }))
            );
        });

        test('should return 404 if payment record not found', async () => {
            mockPrismaOps.payment.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/payments/verify?reference=mockReference&paymentId=nonExistentPayment');

            expect(res.statusCode).toEqual(404);
            expect(res.body).toHaveProperty('error', 'Payment record not found');
        });

        test('should return 404 if transaction not found on Solana', async () => {
            const mockPayment = { id: 'payment123', orderId: 'order1', amount: 100, status: 'PENDING' };
            mockPrismaOps.payment.findUnique.mockResolvedValue(mockPayment);
            // Make sure the error thrown is an instance of the mocked error class
            solanaPay.findReference.mockImplementation(() => { throw new (jest.requireMock('@solana/pay').FindReferenceError)(); });


            const res = await request(app)
                .get('/api/payments/verify?reference=mockReference&paymentId=payment123');

            expect(res.statusCode).toEqual(404);
            expect(res.body).toHaveProperty('error', 'Transaction not found');
        });

        test('should return 400 if transaction validation fails', async () => {
            const mockPayment = { id: 'payment123', orderId: 'order1', amount: 100, status: 'PENDING' };
            mockPrismaOps.payment.findUnique.mockResolvedValue(mockPayment);
            solanaPay.findReference.mockResolvedValue({ signature: 'mockSignature' });
            solanaPay.validateTransfer.mockImplementation(() => { throw new (jest.requireMock('@solana/pay').ValidateTransferError)(); });


            const res = await request(app)
                .get('/api/payments/verify?reference=mockReference&paymentId=payment123');

            expect(res.statusCode).toEqual(400);
            expect(res.body).toHaveProperty('error', 'Transaction validation failed');
        });
    });
});
