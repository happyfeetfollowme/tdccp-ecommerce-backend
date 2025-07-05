
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const sampleImages = [
  'monitor.jpg', 'keyboard.jpg', 'mouse.jpg', 'laptop.jpg', 'phone.jpg',
  'tablet.jpg', 'headphones.jpg', 'speaker.jpg', 'camera.jpg', 'printer.jpg',
  'router.jpg', 'ssd.jpg', 'hdd.jpg', 'ram.jpg', 'gpu.jpg',
  'cpu.jpg', 'motherboard.jpg', 'case.jpg', 'psu.jpg', 'fan.jpg',
  'usb-drive.jpg', 'sd-card.jpg', 'projector.jpg', 'tv.jpg', 'watch.jpg',
  'drone.jpg', 'mic.jpg', 'webcam.jpg', 'scanner.jpg', 'smart-light.jpg',
  'smart-lock.jpg', 'thermostat.jpg', 'vr-headset.jpg', 'gamepad.jpg', 'joystick.jpg',
  'graphics-tablet.jpg', 'fitness-band.jpg', 'e-reader.jpg', 'bluetooth-adapter.jpg', 'car-cam.jpg',
  'dash-cam.jpg', 'action-cam.jpg', 'tripod.jpg', 'gimbal.jpg', 'lens.jpg',
  'flash.jpg', 'battery-pack.jpg', 'charger.jpg', 'cable.jpg', 'adapter.jpg'
];

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  for (let i = 1; i <= 50; i++) {
    await prisma.product.create({
      data: {
        name: `Product ${i}`,
        description: `This is a description for Product ${i}.`,
        price: parseFloat((getRandomInt(10, 500) + Math.random()).toFixed(2)),
        stock: getRandomInt(0, 100),
        imageUrl: `/uploads/${sampleImages[(i-1) % sampleImages.length]}`,
        walletAddress: `0x${getRandomInt(10000000,99999999).toString(16)}${getRandomInt(10000000,99999999).toString(16)}`
      }
    });
  }
  console.log('Seeded 50 products!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
