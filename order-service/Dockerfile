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

# Install prisma-db dependencies (assuming it has its own)
WORKDIR /usr/src/app/prisma-db
RUN npm install

# Copy prisma-db source (JavaScript now, as per your last update)
COPY prisma-db/src ./src
# Removed 'RUN npm run build' as prisma-db source is now JS, no transpilation needed.

# --- 2. Copy the centralized Prisma schema ---
# Go back to the root of the app directory
WORKDIR /usr/src/app
COPY prisma-db/prisma ./prisma

# Generate Prisma client (using the copied schema)
RUN npx prisma generate --schema=prisma/schema.prisma

# --- 3. Setup the 'order-service' module ---
# Create the directory for order-service within the app's root
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
COPY order-service/.gitignore ./

# Expose the port the service listens on
EXPOSE 3003

# Command to run the application
CMD ["sh", "-c", "npm start"]
