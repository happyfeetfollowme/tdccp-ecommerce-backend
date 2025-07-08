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

# Install prisma-db dependencies (assuming it has its own)
WORKDIR /usr/src/app/prisma-db
RUN npm install

# Copy prisma-db source (now in JavaScript, so no build step needed)
COPY prisma-db/src ./src

# --- 2. Copy the centralized Prisma schema ---
# Go back to the root of the app directory
WORKDIR /usr/src/app
COPY prisma-db/prisma ./prisma

# Generate Prisma client (using the copied schema)
RUN npx prisma generate --schema=prisma/schema.prisma

# --- 3. Setup the 'user-service' module ---
# Create the directory for user-service within the app's root
RUN mkdir -p user-service

# Copy user-service's package files
WORKDIR /usr/src/app/user-service
COPY user-service/package.json ./
COPY user-service/package-lock.json ./

# Install user-service dependencies
# Use --omit=dev to install only production dependencies, reducing image size
RUN npm install --omit=dev

# Copy user-service's source code and other necessary files (like tests, .gitignore)
COPY user-service/src ./src
COPY user-service/tests ./tests
COPY user-service/.gitignore ./

# Expose the port the service listens on
EXPOSE 3001

# Command to run the application
# 'prisma migrate deploy' is removed as it's handled by the dedicated 'prisma-migrate' service.
# The 'npm start' command will execute 'node src/index.js' from the current WORKDIR (/usr/src/app/user-service).
CMD ["sh", "-c", "npm start"]