FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /home/node/.codex && chown node:node /home/node/.codex
COPY src ./src
USER node
ENV NODE_ENV=production
ENV PORT=8080
ENV HCR_BIND=0.0.0.0
EXPOSE 8080
CMD ["node", "src/server/index.js"]
