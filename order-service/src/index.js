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
    } catch (error) {
        console.error('Error connecting to RabbitMQ:', error);
        setTimeout(connectRabbitMQ, 5000); // Retry connection after 5 seconds
    }
}

connectRabbitMQ();

const publishEvent = (eventName, data) => {
    if (channel) {
        channel.publish('', 'order_events', Buffer.from(JSON.stringify({ eventName, data })));
        console.log(`Published event: ${eventName}`);
    } else {
        console.warn('RabbitMQ channel not available. Event not published.');
    }
};

const { authenticateJWT } = require('./middleware/auth');

// Cart Management
app.get('/api/cart', authenticateJWT, async (req, res) => {
    let cart = await prisma.cart.findUnique({ where: { userId: req.userId } });
    if (!cart) {
        cart = await prisma.cart.create({ data: { userId: req.userId, items: [] } });
    }
    // Enrich items with imageUrl from product if missing
    const itemsWithImageUrl = cart.items && Array.isArray(cart.items)
        ? await Promise.all(
            cart.items.map(async item => {
                if (!item.imageUrl && item.productId) {
                    // Try to fetch product from DB
                    if (prisma.product && typeof prisma.product.findUnique === 'function') {
                        const product = await prisma.product.findUnique({ where: { id: item.productId } });
                        return {
                            ...item,
                            imageUrl: product && product.imageUrl ? product.imageUrl : null
                        };
                    } else {
                        return { ...item, imageUrl: null };
                    }
                }
                return item;
            })
        )
        : [];
    res.json({ ...cart, items: itemsWithImageUrl });
});

app.post('/api/cart/items', authenticateJWT, async (req, res) => {
    const { productId, name, price, quantity, walletAddress, imageUrl } = req.body;
    let cart = await prisma.cart.findUnique({ where: { userId: req.userId } });

    if (!cart) {
        cart = await prisma.cart.create({ data: { userId: req.userId, items: [] } });
    }

    const items = cart.items ? JSON.parse(JSON.stringify(cart.items)) : [];
    const existingItemIndex = items.findIndex(item => item.productId === productId);

    if (existingItemIndex > -1) {
        items[existingItemIndex].quantity += quantity;
    } else {
        items.push({ productId, name, price, quantity, walletAddress, imageUrl });
    }

    const updatedCart = await prisma.cart.update({
        where: { id: cart.id },
        data: { items: items }
    });
    res.json(updatedCart);
});

app.put('/api/cart/items/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });

    if (!cart) {
        return res.status(404).send('Cart not found');
    }

    const items = cart.items ? JSON.parse(JSON.stringify(cart.items)) : [];
    const itemIndex = items.findIndex(item => item.productId === id);

    if (itemIndex > -1) {
        items[itemIndex].quantity = quantity;
        const updatedCart = await prisma.cart.update({
            where: { id: cart.id },
            data: { items: items }
        });
        res.json(updatedCart);
    } else {
        res.status(404).send('Item not found in cart');
    }
});

app.delete('/api/cart/items/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });

    if (!cart) {
        return res.status(404).send('Cart not found');
    }

    const items = cart.items ? JSON.parse(JSON.stringify(cart.items)) : [];
    const filteredItems = items.filter(item => item.productId !== id);

    const updatedCart = await prisma.cart.update({
        where: { id: cart.id },
        data: { items: filteredItems }
    });
    res.json(updatedCart);
});

// Order Management
app.post('/api/orders', authenticateJWT, async (req, res) => {
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });

    if (!cart || !cart.items || cart.items.length === 0) {
        return res.status(400).send('Cart is empty');
    }

    const itemsByWallet = cart.items.reduce((acc, item) => {
        const wallet = item.walletAddress || 'default'; // Group by walletAddress
        if (!acc[wallet]) {
            acc[wallet] = [];
        }
        acc[wallet].push(item);
        return acc;
    }, {});

    const createdOrders = [];
    for (const wallet in itemsByWallet) {
        const orderItems = itemsByWallet[wallet];
        const total = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const order = await prisma.order.create({
            data: {
                userId: req.userId,
                status: 'PROCESSING',
                total,
                items: orderItems,
            }
        });
        createdOrders.push(order);
        publishEvent('OrderCreated', { orderId: order.id, userId: order.userId, items: order.items });
    }

    // Clear the cart after creating orders
    await prisma.cart.update({
        where: { id: cart.id },
        data: { items: [] }
    });

    res.status(201).json(createdOrders);
});

app.get('/api/orders', authenticateJWT, async (req, res) => {
    // Disable caching for this endpoint to always return fresh data
    res.set('Cache-Control', 'no-store');
    console.log(`Fetching orders for user: ${req.userId}`);
    const orders = await prisma.order.findMany({ where: { userId: req.userId } });
    console.log(`Found ${orders.length} orders for user ${req.userId}`);
    res.json(orders);
});

app.get('/api/orders/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    console.log(`Fetching order ${id} for user ${req.userId}`);
    
    const order = await prisma.order.findUnique({ where: { id, userId: req.userId } });
    console.log(`Order found:`, order ? 'Yes' : 'No');
    
    if (!order) {
        console.log(`Order ${id} not found for user ${req.userId}`);
        return res.status(404).send('Order not found');
    }
    
    console.log(`Returning order:`, order.id);
    res.json(order);
});

// Admin Endpoints
app.get('/api/admin/orders', authenticateJWT, async (req, res) => {
    // In a real app, you'd add admin role check here
    const orders = await prisma.order.findMany();
    res.json(orders);
});

app.put('/api/admin/orders/:id', authenticateJWT, async (req, res) => {
    // In a real app, you'd add admin role check here
    const { id } = req.params;
    const { status, shippingFee, total } = req.body;

    const updatedOrder = await prisma.order.update({
        where: { id },
        data: { status, shippingFee, total }
    });

    if (status) {
        publishEvent('OrderStatusUpdated', { orderId: updatedOrder.id, newStatus: updatedOrder.status });
    }

    res.json(updatedOrder);
});

// Debug endpoint to check current user
app.get('/api/debug/user', authenticateJWT, async (req, res) => {
    console.log("Debug endpoint hit - User ID:", req.userId);
    res.json({ userId: req.userId, message: "Current authenticated user" });
});

const PORT = process.env.PORT;
const server = app.listen(PORT, () => {
    console.log(`Order service listening on port ${PORT}`);
});

module.exports = { app, server };
