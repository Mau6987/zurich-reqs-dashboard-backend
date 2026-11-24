# Zurich Backend (NestJS)

Backend API para **Farmacias Zurich**. Construido con **NestJS**. Actúa como proxy PostgREST sobre PostgreSQL y proxy de webhooks hacia n8n.

## Arquitectura

```
Frontend (Next.js)  →  zurich-backend (NestJS)  →  PostgreSQL (esquema api)
                                                 →  n8n (webhook zurich-ui)
```

## Módulos

| Módulo | Descripción |
|---|---|
| `DatabaseModule` | Pool de PostgreSQL (`pg`), inyección global |
| `AuthModule` | Guard JWT (verificación HMAC-SHA256) |
| `ApiModule` | Proxy PostgREST: GET/PATCH/POST sobre vistas `api.*` |
| `AccionModule` | Webhook proxy: aprobar/rechazar/reagendar → n8n |

## Endpoints

### API PostgREST (GET/PATCH/POST)

Todos bajo `/api/:vista`. Filtros estilo PostgREST:

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/embudo` | GET | Pedidos y monto por estado |
| `/api/metricas_diarias` | GET | Pedidos, monto y rechazos por día |
| `/api/pedidos` | GET | Lista de pedidos |
| `/api/pedido_items` | GET | Líneas de un pedido (`?pedido_id=eq.N`) |
| `/api/eventos_pedido` | GET | Timeline de cambios de estado |
| `/api/tiempos_aprobacion` | GET | Tiempo entre estados |
| `/api/mensajes` | GET | Conversaciones WhatsApp |
| `/api/rotacion` | GET | Rotación y prioridad por sucursal |
| `/api/laboratorios` | GET | Laboratorios con plazos |
| `/api/sucursales` | GET/PATCH/POST | Sucursales (CRUD data maestra) |
| `/api/config` | GET/PATCH | Configuración del sistema |

**Filtros:** `?estado=eq.APROBADO`, `?monto=gt.1000`, `?order=creado.desc`, `?limit=50`

**Paginación:** Header `Range: 0-49` + `Prefer: count=exact` → respuesta con `Content-Range`.

### Webhook Proxy

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/ui/accion` | POST | Aprobar/rechazar/reagendar pedido (reenvía a n8n) |

Body: `{ "accion": "aprobar|rechazar|reagendar", "codigo": "PED-...", "motivo": "...", "fecha": "..." }`

### Health Check

| Endpoint | Método | Descripción |
|---|---|---|
| `/health` | GET | Estado del servidor |

## Configuración

Copia `.env.example` a `.env` y completa:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `POSTGRES_URL` | Connection string de PostgreSQL |
| `N8N_UI_WEBHOOK_URL` | URL del webhook de n8n para acciones |
| `PORT` | Puerto del servidor (default: 4000) |
| `JWT_SECRET` | Secreto para verificar JWT (vacío = modo dev) |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma |

## Desarrollo

```bash
pnpm install
pnpm start:dev
```

## Producción

```bash
pnpm build
pnpm start:prod
```

## Docker

```bash
docker build -t zurich-backend .
docker run -p 4000:4000 --env-file .env zurich-backend
```
