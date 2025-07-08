FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package.json and lock file
COPY ./user-service/package*.json ./
# Copy centralized prisma-db folder
COPY prisma-db/prisma ./prisma
COPY prisma-db/src ./prisma-db/src
# Install dependencies
RUN npm install
# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma
# Copy service source code
COPY ./user-service/. .

EXPOSE 3001

# Run migrations and start service
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node src/index.js"]
