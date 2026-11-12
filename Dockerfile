FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node server.js index.html icon.svg ./
COPY --chown=node:node vendor ./vendor

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]
