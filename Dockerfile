FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 4000
CMD ["sh", "-c", "node src/migrate.js && (node src/worker.js &) && node src/server.js"]
