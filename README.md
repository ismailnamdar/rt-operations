# Rugtomize Operations

## Requirements

- Node.js 24.x, as specified in `package.json`.

## Project commands

Install dependencies from the lockfile:

```sh
npm ci
```

| Command | Purpose |
| --- | --- |
| `npm start` | Run `app/server.mjs`. |
| `npm test` | Run the Node.js tests in `test/*.test.mjs`. |
| `npm run user` | Run the user management CLI in `app/users.mjs`. |
| `npm run build` | Run `scripts/build.mjs`. |

## Deployment

See [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) for deployment and configuration instructions.
