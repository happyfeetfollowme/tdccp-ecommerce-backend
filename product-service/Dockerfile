FROM node:18-alpine

WORKDIR /usr/src/app


COPY ./product-service/package*.json ./
RUN npm install
# Copy centralized prisma-db folder
COPY prisma-db/prisma ./prisma
COPY prisma-db/src ./prisma-db/src
RUN npx prisma generate --schema=prisma/schema.prisma

COPY . .

EXPOSE 3002

CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node src/index.js"]
