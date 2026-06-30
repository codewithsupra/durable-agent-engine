FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-contrib supervisor \
    && rm -rf /var/lib/apt/lists/*

ENV PGDATA=/var/lib/postgresql/data
ENV DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_engine
ENV PORT=8080

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql

COPY deploy/init-db.sh /app/deploy/init-db.sh
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN chmod +x /app/deploy/init-db.sh

EXPOSE 8080
CMD ["/app/deploy/init-db.sh"]
