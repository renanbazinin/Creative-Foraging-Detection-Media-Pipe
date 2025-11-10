# Creative Foraging API Server

## API Overview

| Method | Path                                   | Description                          |
|--------|----------------------------------------|--------------------------------------|
| GET    | `/health`                              | Health check                         |
| GET    | `/api/sessions`                        | List available session game IDs      |
| GET    | `/api/sessions/:sessionGameId`         | Fetch a session by game ID           |
| POST   | `/api/sessions`                        | Create or update session metadata    |
| POST   | `/api/sessions/:sessionGameId/moves`   | Append a move to a session           |
| PATCH  | `/api/sessions/:sessionGameId/moves/:moveId` | Update the `player` field for a move |

All POST/PATCH requests expect JSON bodies.

