# Xano MCP AI Chat

Full-stack chat app that talks to a **Xano MCP** (Model Context Protocol) server over JSON-RPC 2.0 and lets the user switch between **Anthropic Claude** and **Google Gemini** without losing conversation context.

## Prerequisites

- **Node.js 18+** (uses native `fetch`)
- Accounts / keys for Anthropic, Google AI Studio (Gemini), and your Xano MCP endpoint

## Setup

1. **Clone or copy this project** and install dependencies:

   ```bash
   cd /path/to/gemini-mcp-test
   npm install
   ```

2. **Configure environment variables**

   Copy the example file and edit it with your real secrets:

   ```bash
   cp backend/.env.example backend/.env
   ```

   | Variable | Description |
   |----------|-------------|
   | `ANTHROPIC_API_KEY` | From [Anthropic Console](https://console.anthropic.com/) |
   | `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/apikey) |
   | `XANO_MCP_URL` | Your Xano MCP HTTP URL (e.g. `https://your-workspace.xano.io/mcp`) |
   | `XANO_MCP_TOKEN` | Optional static Xano bearer. Omit if you use login below — then the **login access token** is sent as the same MCP `Authorization: Bearer` (for tool APIs). |
   | `XANO_AUTH_ENDPOINT`, `XANO_USERNAME`, `XANO_PASSWORD` | Optional **password login**: that access token becomes the MCP bearer (same as `your_xano_bearer_token`). Optional `TOKEN_EXPIRY_SECONDS`, `XANO_AUTH_LOGIN_BODY`, `XANO_REFRESH_*`. |
   | `PORT` | HTTP port for Express (default `3000`) |

   `dotenv` loads **`backend/.env`** when you start the server from the project root (see `server.js`).

3. **Start the server**

   ```bash
   npm start
   ```

   On startup the app:

   - Verifies required env vars are set (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XANO_MCP_URL`; `XANO_MCP_TOKEN` is optional).
   - Calls MCP `tools/list` once and logs: `Server running on port X | MCP tools loaded: Y`.

4. **Open the UI**

   Visit [http://localhost:3000](http://localhost:3000) (or your `PORT`).

## How it works

- **Backend** (`backend/server.js`): Express serves the API and static files from `frontend/`.
- **MCP** (`backend/services/mcpService.js`): JSON-RPC `tools/list` and `tools/call` to `XANO_MCP_URL` with `Authorization: Bearer XANO_MCP_TOKEN`. Tool definitions are cached in memory after the first successful list.
- **Claude** (`backend/services/anthropicService.js`): Model `claude-sonnet-4-5`, tools mapped to Anthropic’s `input_schema`, agent loop until `end_turn`.
- **Gemini** (`backend/services/geminiService.js`): Model from **`GEMINI_MODEL`** (default **`gemini-3-flash-preview`**); optional **429 retries** with backoff. MCP tools mapped to `functionDeclarations`, function-calling loop until the model returns text only.
- **API**: `POST /api/chat` with `{ "message", "provider": "anthropic" | "gemini", "history": [...] }`.

## Frontend behavior

- Provider toggle at the top (Anthropic / Gemini); switching providers does **not** clear history.
- Each assistant bubble shows a **Claude** or **Gemini** badge.
- Optimistic user bubble, typing indicator, and inline error messages if the request fails.

## Adding or changing `.env` values

- Edit **`backend/.env`** (never commit it; it is gitignored).
- Restart `npm start` after changes so new variables are picked up.

## Development

```bash
npm run dev
```

Uses `node --watch` to restart the server on file changes.
