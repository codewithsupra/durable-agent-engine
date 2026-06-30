#!/bin/bash
set -e

if [ ! -d "$PGDATA/base" ]; then
  echo "Initializing fresh Postgres data directory..."
  su postgres -c "/usr/lib/postgresql/*/bin/initdb -D $PGDATA"
  su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -w start"
  su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
  su postgres -c "createdb agent_engine"
  su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D $PGDATA -m fast -w stop"
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
