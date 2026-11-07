FROM node:20-bookworm-slim

# Install C/C++ compilers and Python 3 for the Judge engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/judge/package.json ./packages/judge/
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/cli/package.json ./apps/cli/
COPY apps/web/package.json ./apps/web/

# Install dependencies (only production)
RUN npm ci --omit=dev --ignore-scripts

# Copy application source code
COPY apps/api ./apps/api
COPY packages/judge ./packages/judge
COPY packages/sdk ./packages/sdk

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "apps/api/src/server.js"]
