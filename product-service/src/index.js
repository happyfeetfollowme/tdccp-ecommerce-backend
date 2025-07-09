require('dotenv').config();
const express = require('express');
const amqp = require('amqplib');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { prisma } = require('../../prisma-db/src');

const app = express();

// Multer setup for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Supabase client setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for upload
);

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

// Helper to upload images to Supabase
async function uploadImagesToSupabase(files) {
  const uploadedUrls = [];
  for (const file of files) {
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });
    if (uploadError) {
      throw new Error(uploadError.message);
    }
    const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(filePath);
    uploadedUrls.push(publicUrlData.publicUrl);
  }
  return uploadedUrls;
}

// Helper to delete images from Supabase
async function deleteImagesFromSupabase(urls) {
  for (const url of urls) {
    const parts = url.split('/');
    const idx = parts.findIndex(p => p === 'images');
    if (idx !== -1 && parts.length > idx + 1) {
      const filePath = parts.slice(idx + 1).join('/');
      await supabase.storage.from('images').remove([filePath]);
    }
  }
}

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

// Admin Endpoints
app.get('/api/admin/products', authenticateJWT, async (req, res) => {
    // In a real app, you'd add admin role check here
    const products = await prisma.product.findMany();
    res.json(products);
});


// [POST] Create product with optional images
app.post('/api/admin/products', authenticateJWT, upload.array('images', 10), async (req, res) => {
  try {
    const { name, description, price, walletAddress, stock } = req.body;
    let images = [];
    if (req.files && req.files.length > 0) {
      images = await uploadImagesToSupabase(req.files);
    }
    // Always provide imageUrl (first image or empty string)
    const imageUrl = images.length > 0 ? images[0] : '';
    const product = await prisma.product.create({
      data: { name, description, price: parseFloat(price), imageUrl, walletAddress, stock: parseInt(stock) },
    });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// [PUT] Update product with optional images (replace old images)
app.put('/api/admin/products/:id', authenticateJWT, upload.array('images', 10), async (req, res) => {
  const { id } = req.params;
  try {
    const { name, description, price, walletAddress, stock } = req.body;
    let imageUrl;
    if (req.files && req.files.length > 0) {
      // Get old imageUrl
      const oldProduct = await prisma.product.findUnique({ where: { id } });
      // Optionally, you could delete the old image from Supabase here if needed
      const uploadedImages = await uploadImagesToSupabase(req.files);
      imageUrl = uploadedImages.length > 0 ? uploadedImages[0] : (oldProduct ? oldProduct.imageUrl : '');
    }
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name,
        description,
        price: price !== undefined ? parseFloat(price) : undefined,
        imageUrl: imageUrl !== undefined ? imageUrl : undefined,
        walletAddress,
        stock: stock !== undefined ? parseInt(stock) : undefined
      }
    });
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/products/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
});

const PORT = process.env.PORT || 3002;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Product service listening on port ${PORT}`);
});

module.exports = { app, server, uploadImagesToSupabase };
