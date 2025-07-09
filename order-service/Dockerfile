# Use a Node.js base image
FROM node:18-alpine

# Set a common working directory for the entire monorepo structure within the container.
WORKDIR /usr/src/app

# --- 1. Setup the shared 'prisma-db' module ---
# Create the directory for prisma-db
RUN mkdir -p prisma-db

# Copy prisma-db's package files
COPY prisma-db/package.json ./prisma-db/
COPY prisma-db/package-lock.json ./prisma-db/

# Change WORKDIR to prisma-db's directory to install its dependencies and generate Prisma Client locally
WORKDIR /usr/src/app/prisma-db
RUN npm install
COPY prisma-db/src ./src
COPY prisma-db/prisma ./prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

# --- 2. Setup the 'order-service' module ---
# Create the directory for order-service within the app's root
WORKDIR /usr/src/app
RUN mkdir -p order-service

# Copy order-service's package files
WORKDIR /usr/src/app/order-service
COPY order-service/package.json ./
COPY order-service/package-lock.json ./

# Install order-service dependencies
RUN npm install --omit=dev

# Copy order-service's source code and other necessary files (like tests, .gitignore)
COPY order-service/src ./src
COPY order-service/tests ./tests

# Expose the port the service listens on
EXPOSE 3003

# Command to run the application
CMD ["sh", "-c", "npm start"]
