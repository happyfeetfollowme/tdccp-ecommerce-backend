# TDCCP E-commerce Backend Monorepo

This backend monorepo for the E-commerce platform is built in close collaboration with the GitHub Copilot agent, combining developer expertise with AI-powered assistance for a robust, scalable, and well-documented architecture.

It contains all backend microservices, a centralized Prisma database package, and configuration for local development and cloud deployment (Docker, Render, Supabase, etc).

## Structure

```
tdccp-ecommerce-backend/
├── api-gateway/         # API Gateway for routing and authentication
├── user-service/        # User management microservice
├── product-service/     # Product catalog microservice
├── order-service/       # Order management microservice
├── payment-service/     # Payment processing microservice
├── prisma-db/           # Centralized Prisma schema, migrations, and generated client
├── docker-compose.yml   # Local development orchestration
├── render.yaml          # Render.com deployment configuration
└── .env                 # Shared environment variables (not committed)
```

## Centralized Prisma Setup
- All services use a single, shared Prisma schema and client in `prisma-db`.
- The Prisma client is generated to `prisma-db/generated/client`.
- Each service imports the client with:
  ```js
  const { PrismaClient } = require('../../prisma-db/generated/client');
  const prisma = new PrismaClient();
  ```
- Migrations are managed by the `prisma-migrate` worker/service.

## Local Development

1. **Copy `.env.example` to `.env` and fill in secrets and database URLs.**
2. **Start all services with Docker Compose:**
   ```sh
   docker compose up --build --remove-orphans
   ```
3. **Access services:**
   - API Gateway: http://localhost:3000
   - User Service: http://localhost:3001
   - Product Service: http://localhost:3002
   - Order Service: http://localhost:3003
   - Payment Service: http://localhost:3004
   - RabbitMQ UI: http://localhost:15672

## Deployment (Render.com)
- See `render.yaml` for service definitions and build commands.
- Each service runs `npx prisma generate --schema=../prisma-db/prisma/schema.prisma --output=../prisma-db/generated/client` during build.
- Set all secrets and environment variables in the Render dashboard.
- Use Supabase or your own Postgres for the `DATABASE_URL`.

## Environment Variables
- All secrets and connection strings are managed via `.env` (local) or the Render dashboard (cloud).
- Example variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `SESSION_SECRET`
  - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`
  - `RABBITMQ_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

## Migrations
- Run migrations with the `prisma-migrate` service/worker.
- To create a new migration locally:
  ```sh
  cd prisma-db
  npx prisma migrate dev --name <migration-name>
  ```

## Notes
- All services communicate via HTTP using Docker Compose service names or Render internal URLs.
- The API Gateway handles authentication and proxies requests to backend services.
- All code is JavaScript (Node.js, Express, Prisma ORM).

---

For more details, see the individual service folders and the `prisma-db` package.
