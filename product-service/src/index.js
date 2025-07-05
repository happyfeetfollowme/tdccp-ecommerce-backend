require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const amqp = require('amqplib');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

let channel;

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        channel = await connection.createChannel();
        await channel.assertQueue('order_events', { durable: true });
        console.log('Connected to RabbitMQ');

        channel.consume('order_events', async (msg) => {
            if (msg !== null) {
                const { eventName, data } = JSON.parse(msg.content.toString());
                console.log(`Received event: ${eventName}`, data);

                try {
                    switch (eventName) {
                        case 'OrderCreated':
                            for (const item of data.items) {
                                await prisma.product.update({
                                    where: { id: item.productId },
                                    data: {
                                        stock: { decrement: item.quantity },
                                        preservedStock: { increment: item.quantity }
                                    }
                                });
                            }
                            break;
                        case 'OrderPaid':
                            if (data.items && Array.isArray(data.items)) {
                                for (const item of data.items) {
                                    await prisma.product.update({
                                        where: { id: item.productId },
                                        data: {
                                            preservedStock: { decrement: item.quantity }
                                        }
                                    });
                                }
                            } else {
                                console.warn(`OrderPaid event for order ${data.orderId} missing items. Stock not updated.`);
                            }
                            break;
                        case 'OrderCanceled':
                            if (data.items && Array.isArray(data.items)) {
                                for (const item of data.items) {
                                    await prisma.product.update({
                                        where: { id: item.productId },
                                        data: {
                                            stock: { increment: item.quantity },
                                            preservedStock: { decrement: item.quantity }
                                        }
                                    });
                                }
                            } else {
                                console.warn(`OrderCanceled event for order ${data.orderId} missing items. Stock not updated.`);
                            }
                            break;
                    }
                    channel.ack(msg);
                } catch (error) {
                    console.error(`Error processing event ${eventName}:`, error);
                    // Requeue message if processing fails
                    channel.nack(msg);
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error('Error connecting to RabbitMQ or consuming messages:', error);
        setTimeout(connectRabbitMQ, 5000); // Retry connection after 5 seconds
    }
}

connectRabbitMQ();

const { authenticateJWT } = require('./middleware/auth');

// API Endpoints
app.get('/api/products', async (req, res) => {
    const { search, sortBy, order, page = 1, pageSize = 10 } = req.query;
    const where = {};
    const orderBy = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } }
        ];
    }

    if (sortBy) {
        orderBy[sortBy] = order || 'asc';
    }

    const products = await prisma.product.findMany({
        where,
        orderBy,
        skip: (parseInt(page) - 1) * parseInt(pageSize),
        take: parseInt(pageSize)
    });

    const totalProducts = await prisma.product.count({ where });

    res.json({
        products,
        totalProducts,
        totalPages: Math.ceil(totalProducts / pageSize),
        currentPage: parseInt(page)
    });
});

// Get a single product by ID
app.get('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const product = await prisma.product.findUnique({
            where: { id },
        });
        if (product) {
            res.json(product);
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (error) {
        console.error(`Error fetching product ${id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/products', authenticateJWT, async (req, res) => {
    if (!req.isAdmin) {
        return res.status(403).send('Forbidden');
    }
    const { name, description, price, imageUrl, walletAddress, stock } = req.body;
    const product = await prisma.product.create({
        data: { name, description, price, imageUrl, walletAddress, stock }
    });
    res.status(201).json(product);
});

app.put('/api/products/:id', authenticateJWT, async (req, res) => {
    if (!req.isAdmin) {
        return res.status(403).send('Forbidden');
    }
    const { id } = req.params;
    const { name, description, price, imageUrl, walletAddress, stock } = req.body;
    const updatedProduct = await prisma.product.update({
        where: { id },
        data: { name, description, price, imageUrl, walletAddress, stock }
    });
    res.json(updatedProduct);
});

app.delete('/api/products/:id', authenticateJWT, async (req, res) => {
    if (!req.isAdmin) {
        return res.status(403).send('Forbidden');
    }
    const { id } = req.params;
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
});

const PORT = process.env.PORT;
const server = app.listen(PORT, () => {
    console.log(`Product service listening on port ${PORT}`);
});

module.exports = { app, server };
