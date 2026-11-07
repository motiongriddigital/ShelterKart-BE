FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --ignore-scripts
COPY backend backend
COPY tools tools
COPY docs docs
COPY ops/sandbox/probes ops/sandbox/probes
RUN chown -R node:node /app
USER node
WORKDIR /app/backend
