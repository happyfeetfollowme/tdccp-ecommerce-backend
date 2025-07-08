FROM node:18-alpine

WORKDIR /usr/src/app

# Install Prisma CLI globally
RUN npm install -g prisma

# Copy only the schema and migrations
COPY ../prisma-db/prisma ./prisma

CMD ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]
