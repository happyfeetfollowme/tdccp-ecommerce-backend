FROM node:18-alpine

WORKDIR /usr/src/app


COPY ./payment-service/package*.json ./
RUN npm install
COPY ../prisma ./prisma
RUN npx prisma generate --schema=prisma/schema.prisma

COPY . .

EXPOSE 3004

CMD ["sh", "-c", "npx prisma migrate deploy --schema=../prisma/schema.prisma && node src/index.js"]
