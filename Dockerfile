# Use Node.js 20 Alpine for lightweight container
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Expose no ports (worker process)
EXPOSE

# Run the worker
CMD ["node", "dist/worker.js"]