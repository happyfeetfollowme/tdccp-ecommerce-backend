FROM node:18-alpine

# Set a common working directory for the entire monorepo structure within the container.
# All subsequent COPY commands will be relative to the host's build context (the monorepo root)
# and copy into this WORKDIR inside the container.
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

# Copy prisma-db source
# This assumes you have a "build": "tsc" script in prisma-db/package.json
COPY prisma-db/src ./src
RUN npm run build

CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node src/index.js"]
