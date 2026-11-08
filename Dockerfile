FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node client ./client
COPY --chown=node:node config ./config
COPY --chown=node:node config.js ./config.js
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
