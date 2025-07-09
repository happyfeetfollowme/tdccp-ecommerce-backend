# Use a Node.js base image
FROM node:18-alpine

# Set a common working directory for the entire monorepo structure within the container.
# All subsequent COPY commands will be relative to the host's build context (the monorepo root)
# and copy into this WORKDIR inside the container.
WORKDIR /usr/src/app

# --- 1. Setup the shared 'prisma-db' module ---
# Create the directory for prisma-db within the app's root
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

# --- 2. Setup the 'product-service' module ---
# Create the directory for product-service within the app's root
WORKDIR /usr/src/app
RUN mkdir -p product-service

# Copy product-service's package files
WORKDIR /usr/src/app/product-service
COPY product-service/package.json ./
COPY product-service/package-lock.json ./

# Install product-service dependencies
# Use --omit=dev to install only production dependencies, reducing image size
RUN npm install --omit=dev

# Copy product-service's source code and other necessary files (like tests)
COPY product-service/src ./src
COPY product-service/tests ./tests

# Expose the port the service listens on
EXPOSE 3002

# Command to run the application
# 'prisma migrate deploy' is removed as it's handled by the dedicated 'prisma-migrate' service.
# The 'npm start' command will execute 'node src/index.js' from the current WORKDIR (/usr/src/app/product-service).
CMD ["sh", "-c", "npm start"]