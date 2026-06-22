# AuraGate

AuraGate is an intelligent, high-performance API Gateway for Large Language Models. Built with Next.js 16 (App Router), it orchestrates complex LLM requests with minimal latency while enforcing hard limits on costs.

## Features

*   **Multi-Model Routing**: Intelligently routes queries based on semantic complexity.
    *   **Simple Queries**: Gemini 2.5 Flash
    *   **Coding Queries**: Groq Llama 3.3 70B
    *   **Complex Queries**: Gemini 2.5 Pro
*   **Automatic Failover**: Transparently retries requests on alternative providers when rate-limits or timeouts occur.
*   **Tenant Management & Budgets**: Issues per-tenant API keys and enforces strict dollar-amount budgets. Uses PostgreSQL `SELECT FOR UPDATE` for transactional consistency.
*   **PII Scrubbing**: Regex-based redaction of SSNs, Credit Cards, Phone Numbers, and Emails before sending to external APIs.
*   **Redis Edge Caching**: Caches exact-match LLM prompts for immediate <50ms responses, saving compute.
*   **Async Telemetry Pipeline**: Uses BullMQ to offload database writes from the critical request path, ensuring the proxy responds fast. Uses idempotency to prevent duplicate logging.
*   **Admin Dashboard**: Real-time analytics, cost tracking, request routing reasons, latency distributions, and JWT-based authentication for the portal.

## Tech Stack

*   **Framework**: Next.js 16 (App Router, Edge Runtime)
*   **Database**: PostgreSQL (Partitioned `usage_logs` table)
*   **ORM**: Drizzle ORM
*   **Cache & Queue**: Redis (BullMQ)
*   **Authentication**: `jose` (JWT)

## Getting Started

### Prerequisites

*   Docker & Docker Compose
*   Gemini API Key
*   Groq API Key

### Setup

1.  Clone the repository.
2.  Copy `.env.example` to `.env` and fill in the required variables.
    ```env
    # Core
    NODE_ENV="development"

    # Database
    DATABASE_URL="postgres://auragate:secret_password@localhost:5432/auragate"
    REDIS_URL="redis://localhost:6379"

    # LLM Providers
    GEMINI_API_KEY="your_gemini_api_key"
    GROQ_API_KEY="your_groq_api_key"

    # Admin Dashboard Auth
    ADMIN_PASSWORD="super_secret_admin_password"
    ADMIN_JWT_SECRET="generate_a_random_32_char_string"
    ```
3.  Start the infrastructure:
    ```bash
    docker-compose up -d
    ```
4.  Run database migrations:
    ```bash
    npm run db:push
    ```
5.  Start the development server:
    ```bash
    npm run dev
    ```

## Usage

1.  Navigate to `http://localhost:3000/admin-login` and log in with your `ADMIN_PASSWORD`.
2.  Create a **Tenant** and set a budget.
3.  Generate an **API Key** for the tenant.
4.  Send a request to the proxy:

```bash
curl -X POST http://localhost:3000/api/v1/proxy \
  -H "Authorization: Bearer ag_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Write a python script to sort an array." }
    ]
  }'
```

## Architecture Notes

*   The Next.js App Router API `POST /api/v1/proxy` runs on the Edge Runtime (or Node runtime depending on configuration) and handles request validation, PII scrubbing, authentication, and routing.
*   Logging is handled asynchronously. A separate Node.js script `telemetry-worker.ts` processes BullMQ jobs and inserts logs into the `usage_logs` table.
*   Database schema uses PostgreSQL declarative partitioning on `usage_logs` by month to maintain fast querying on the admin dashboard.
