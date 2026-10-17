FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production PORT=3000 DATA_FILE=/app/data/find-ord.sqlite
USER node
EXPOSE 3000
CMD ["npm", "start"]
