# Use a Node.js base image
FROM node:18-alpine

# Set the working directory directly to where the api-gateway's files will reside.
# This aligns with the 'api-gateway' subdirectory within your build context.
WORKDIR /usr/src/app/api-gateway

# Copy api-gateway's package.json and package-lock.json first to leverage Docker's build cache.
# Since the build context is the monorepo root (.), paths are relative to that root.
COPY ./api-gateway/package.json ./
COPY ./api-gateway/package-lock.json ./

# Install api-gateway dependencies
# Use --omit=dev to install only production dependencies, reducing image size.
RUN npm install --omit=dev

# Copy api-gateway's source code and other necessary files (like tests, .gitignore)
# Again, paths are relative to the monorepo root.
COPY ./api-gateway/src ./src
COPY ./api-gateway/tests ./tests
COPY ./api-gateway/.gitignore ./

# Expose the port the service listens on
EXPOSE 3000

# Command to run the application
# 'node src/index.js' will execute correctly from the WORKDIR (/usr/src/app/api-gateway).
CMD [ "node", "src/index.js" ]