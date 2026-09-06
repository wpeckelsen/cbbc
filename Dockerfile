# --- Build stage ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json ./

RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY brands.md ./

# Cap Node's old-space heap for full-feed processing (previously a NODE_OPTIONS env var).
ENV NODE_OPTIONS=--max-old-space-size=4096

CMD ["node", "dist/worker.js"]
