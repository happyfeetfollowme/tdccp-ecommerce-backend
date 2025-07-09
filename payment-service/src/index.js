require('dotenv').config();
const express = require('express');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { createQR, encodeURL, findReference, validateTransfer, FindReferenceError, ValidateTransferError } = require('@solana/pay');
const amqp = require('amqplib');
const { prisma } = require('../../prisma-db/src');

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

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');

app.post('/api/payments/charge', async (req, res) => {
    const { orderId, amount, recipientWallet } = req.body;

    if (!orderId || !amount || !recipientWallet) {
        return res.status(400).json({ error: 'Missing orderId, amount, or recipientWallet' });
    }

    try {
        const recipient = new PublicKey(recipientWallet);
        const reference = new Keypair().publicKey; // Unique reference for the payment

        const payment = await prisma.payment.create({
            data: {
                orderId,
                amount,
                status: 'PENDING',
                transaction: null, // Will be updated after verification
            }
        });

        const url = encodeURL({
            recipient,
            amount: new (require('@solana/web3.js').BN)(amount * (10 ** 9)), // Convert to lamports
            reference,
            label: `Order #${orderId}`,
            message: `Payment for order #${orderId}`,
        });

        res.json({ paymentId: payment.id, solanaPayUrl: url.toString(), reference: reference.toString() });

    } catch (error) {
        console.error('Error initiating payment:', error);
        res.status(500).json({ error: 'Failed to initiate payment' });
    }
});

app.get('/api/payments/verify', async (req, res) => {
    const { reference, paymentId } = req.query;

    if (!reference || !paymentId) {
        return res.status(400).json({ error: 'Missing reference or paymentId' });
    }

    try {
        const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found' });
        }

        if (payment.status === 'COMPLETED') {
            return res.status(200).json({ status: 'COMPLETED', message: 'Payment already verified' });
        }

        const sig = await findReference(connection, new PublicKey(reference), { finality: 'confirmed' });

        await validateTransfer(connection, sig, {
            recipient: new PublicKey(process.env.SHOP_WALLET_ADDRESS), // Your shop's wallet address
            amount: new (require('@solana/web3.js').BN)(payment.amount * (10 ** 9)),
            reference: new PublicKey(reference),
        });

        const updatedPayment = await prisma.payment.update({
            where: { id: paymentId },
            data: { status: 'COMPLETED', transaction: sig.signature },
        });

        publishEvent('OrderPaid', { orderId: updatedPayment.orderId, paymentId: updatedPayment.id, transaction: updatedPayment.transaction });

        res.status(200).json({ status: 'COMPLETED', transaction: updatedPayment.transaction });

    } catch (error) {
        console.error('Error verifying payment:', error);

        if (error instanceof FindReferenceError) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        if (error instanceof ValidateTransferError) {
            return res.status(400).json({ error: 'Transaction validation failed' });
        }

        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

const PORT = process.env.PORT || 3004;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment service listening on port ${PORT}`);
});

module.exports = { app, server };
