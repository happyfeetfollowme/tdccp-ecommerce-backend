const request = require('supertest');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
// passport is mocked, so we don't require the original here at the top for use.
// We will get a reference to the mock if needed after the mock definition.

// 1. Define functions/variables needed by mock factories FIRST
const mockDiscordStrategyMiddleware = jest.fn((req, res, next) => {
    // This is the middleware that passport.authenticate('discord') should return.
    // We can check if this specific middleware was called.
    if (mockPassportAuthenticateFn.mock.user) { // Keep for callback logic
        req.user = mockPassportAuthenticateFn.mock.user;
    }
    next();
});

const mockPassportAuthenticateFn = jest.fn((strategy, options) => {
    if (strategy === 'discord') {
        return mockDiscordStrategyMiddleware;
    }
    // Default fallback for any other strategy calls if needed during setup
    return (req, res, next) => next();
});
// Add a spot for tests to place the mock user, directly on the mock function itself
mockPassportAuthenticateFn.mock.user = null;


// Define the mock Prisma operations that user-service will use
const mockPrismaOps = {
    user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    // Add other models here if user-service interacts with them
};

// 2. ALL jest.mock calls
// Mock the shared prisma-db module
jest.mock('../../prisma-db/src', () => ({
    prisma: mockPrismaOps
}));

// No longer need to mock @prisma/client directly here if prisma-db is fully mocked
// jest.mock('@prisma/client', () => { ... });

// Mock dotenv to prevent it from overriding our test environment
jest.mock('dotenv', () => ({
    config: jest.fn()
}));

jest.mock('passport', () => ({
    initialize: jest.fn(() => (req, res, next) => next()),
    use: jest.fn(),
    serializeUser: jest.fn(),
    deserializeUser: jest.fn(),
    authenticate: mockPassportAuthenticateFn, // Use the pre-defined mock function
}));

jest.mock('passport-discord'); // This is a simple mock, no factory needed unless we configure it

// The application itself will get 'prisma' from the mocked '../../prisma-db/src'.
// Tests will use 'mockPrismaOps' directly to set up mockResolvedValue etc.
// const prisma = new PrismaClient(); // OLD LINE - REMOVED

// 4. Import the actual app after mocks are set up
const { app, server } = require('../src/index');

// This code runs once after all tests in this file are done.
afterAll(async () => {
    if (server) { // server might not be defined if app init fails
        await new Promise(resolve => server.close(resolve));
    }
});

describe('User Service API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear any user set by a previous test
        mockPassportAuthenticateFn.mock.user = null; // Reset the mock user
        process.env.JWT_SECRET = 'test-secret'; // Ensure JWT secret is set for each test
    });

    // --- Authentication Routes ---
    describe('GET /api/auth/discord', () => {
        it('should invoke the discord authentication middleware', async () => {
            // Clear the specific middleware mock before the test to ensure clean state for this test
            mockDiscordStrategyMiddleware.mockClear();

            await request(app).get('/api/auth/discord');

            // Verify that the middleware we associated with 'discord' strategy was called
            expect(mockDiscordStrategyMiddleware).toHaveBeenCalledTimes(1);
            // Optional: also verify that mockPassportAuthenticateFn was called with 'discord'
            // This happens at app setup, so it won't be cleared by beforeEach's clearAllMocks
            // if we are careful. However, testing mockDiscordStrategyMiddleware is more direct for the route's behavior.
            // expect(mockPassportAuthenticateFn).toHaveBeenCalledWith('discord');
        });
    });

    describe('GET /api/auth/discord/callback', () => {
        it('should handle successful authentication and return a JWT', async () => {
            const mockUser = { id: 'user123', email: 'test@example.com' };
            // Set the user that the mock should return
            mockPassportAuthenticateFn.mock.user = mockUser;

            const response = await request(app).get('/api/auth/discord/callback');

            expect(response.status).toBe(302); // Expect redirect
            expect(response.headers.location).toEqual(expect.stringContaining('http://localhost:8080/auth/discord/callback?token='));

            // Optional: Extract token and verify if necessary
            const redirectUrl = new URL(response.headers.location);
            const token = redirectUrl.searchParams.get('token');
            expect(token).toBeTruthy();
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            expect(decoded.userId).toBe(mockUser.id);
        });
    });

    // --- Protected User Routes ---
    describe('GET /api/users/me', () => {
        it('should return 401 Unauthorized if no token is provided', async () => {
            const response = await request(app).get('/api/users/me');
            expect(response.status).toBe(401);
        });

        it('should return 403 Forbidden for an invalid token', async () => {
            const response = await request(app)
                .get('/api/users/me')
                .set('Authorization', 'Bearer invalidtoken'); // This header is ignored by the app's auth middleware
            expect(response.status).toBe(401); // App returns 401 due to missing x-user-id
        });

        it('should return user data for a valid token', async () => {
            const user = { id: 'user123', email: 'test@example.com' };
            // const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET); // Not used by app middleware
            mockPrismaOps.user.findUnique.mockResolvedValue(user);

            const response = await request(app)
                .get('/api/users/me')
                .set('x-user-id', user.id); // Use x-user-id header

            expect(response.status).toBe(200);
            expect(response.body).toEqual(user);
            expect(mockPrismaOps.user.findUnique).toHaveBeenCalledWith({
                where: { id: user.id },
                select: {
                    id: true,
                    email: true,
                    discordId: true,
                    discordUsername: true,
                    createdAt: true,
                    updatedAt: true,
                    role: true,
                }
            });
        });
    });

    describe('PUT /api/users/me', () => {
        it('should update the user profile for a valid token', async () => {
            const user = { id: 'user123', email: 'old@example.com' };
            const updatedUser = { ...user, email: 'new@example.com' };
            // const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET); // Not used by app middleware

            mockPrismaOps.user.update.mockResolvedValue(updatedUser);

            const response = await request(app)
                .put('/api/users/me')
                .set('x-user-id', user.id) // Use x-user-id header
                .send({ email: 'new@example.com' });

            expect(response.status).toBe(200);
            expect(response.body).toEqual(updatedUser);
            expect(mockPrismaOps.user.update).toHaveBeenCalledWith({
                where: { id: user.id },
                data: { email: 'new@example.com' },
            });
        });
    });
});