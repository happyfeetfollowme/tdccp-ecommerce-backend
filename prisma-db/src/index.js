const { PrismaClient } = require('@prisma/client');

global.prisma = global.prisma || new PrismaClient();
const prisma = global.prisma;

module.exports = { prisma };
