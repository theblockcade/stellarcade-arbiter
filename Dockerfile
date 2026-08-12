FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts

EXPOSE 4100
# Runs the migration before the server starts, every container start —
# not via Render's Pre-Deploy Command, which turned out to be a paid-plan
# feature that's silently a no-op on `plan: free` (confirmed: a deploy
# with preDeployCommand set produced zero trace of it running in the
# build/deploy logs, going straight from image build to server listening).
# Baking it into CMD instead works on any plan, since it's just part of
# what "start the container" means here. `exec` hands off PID 1 to the
# server process afterward so it still receives Render's shutdown signals
# directly, matching the previous single-process CMD's behavior.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node dist/server.js"]
