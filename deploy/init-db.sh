#!/bin/bash
set -e

if [ ! -d "$PGDATA/base" ]; then
  echo "Initializing fresh Postgres data directory..."
  su postgres -c "/usr/lib/postgresql/*/bin/initdb -D $PGDATA"

  # Tuned for a 512MB-RAM container shared with Node processes — default
  # Postgres settings (128MB shared_buffers, 100 max_connections) are far
  # too heavy here and contributed to OOM crashes that wiped this
  # ephemeral (volume-less) database on restart.
  cat >> "$PGDATA/postgresql.conf" <<EOF
shared_buffers = 16MB
max_connections = 20
work_mem = 2MB
maintenance_work_mem = 16MB
effective_cache_size = 32MB
EOF

  su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -w start"
  su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
  su postgres -c "createdb agent_engine"
  su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D $PGDATA -m fast -w stop"
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
