const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  // Get some users and products
  const users = await prisma.user.findMany({ take: 5 });
  const products = await prisma.product.findMany({ take: 10 });
  if (users.length === 0 || products.length === 0) {
    console.error('No users or products found. Seed them first!');
    return;
  }

  for (let i = 1; i <= 10; i++) {
    const user = users[getRandomInt(0, users.length - 1)];
    const orderItems = [];
    let total = 0;
    const numItems = getRandomInt(1, 4);
    for (let j = 0; j < numItems; j++) {
      const product = products[getRandomInt(0, products.length - 1)];
      const quantity = getRandomInt(1, 3);
      orderItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        imageUrl: product.imageUrl,
        walletAddress: product.walletAddress
      });
      total += product.price * quantity;
    }
    await prisma.order.create({
      data: {
        userId: user.id,
        status: 'PROCESSING',
        total,
        items: orderItems,
        shippingFee: 10
      }
    });
  }
  console.log('Seeded 10 orders!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
