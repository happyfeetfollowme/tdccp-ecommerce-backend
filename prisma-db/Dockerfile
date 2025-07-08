# Use a Node.js base image suitable for Prisma
FROM node:18-alpine

# Set the working directory for the prisma-db operations within the container.
# This makes subsequent COPY commands and schema paths simpler and more explicit.
WORKDIR /usr/src/app/prisma-db

# Copy prisma-db's package.json and package-lock.json
# Since the build context in docker-compose.yml is the monorepo root (.),
# paths here are relative to that root.
COPY prisma-db/package.json ./
COPY prisma-db/package-lock.json ./

# Install local dependencies, which should include the 'prisma' package (CLI and Client)
RUN npm install

# Copy the centralized Prisma schema and migrations.
# The 'prisma' directory contains schema.prisma and the 'migrations' folder.
# This path is relative to the current WORKDIR.
COPY prisma-db/prisma ./prisma

# Command to run the migration when the container starts.
# 'npx prisma' ensures the locally installed Prisma CLI is used.
# The schema path './prisma/schema.prisma' is relative to the current WORKDIR (/usr/src/app/prisma-db).
CMD ["npx", "prisma", "migrate", "deploy", "--schema=./prisma/schema.prisma"]