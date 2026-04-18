# Local dev containers

Minimal compose for development. Today it's one service — `postgres:16` on
port 5432, persisted in a named volume, dev-only password. The multi-service
stack (server + web + caddy) lands in Phase 8.

Start it:

```
docker compose -f docker/compose.yaml up -d postgres
```

Nuke it (drops the named volume, wipes all data):

```
docker compose -f docker/compose.yaml down -v
```

Connection string (matches `.env.example` at the repo root):

```
DATABASE_URL=postgres://brandfactory:brandfactory@localhost:5432/brandfactory
```
