# Build the TypeScript service with its locked development dependencies.
FROM node:20.19.4-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Install the runtime dependency set separately to keep the final image small.
FROM node:20.19.4-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20.19.4-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
COPY maps ./maps

RUN groupadd --system tactical && useradd --system --gid tactical --home-dir /app tactical \
  && mkdir /app/runtime \
  && chown -R tactical:tactical /app

USER tactical

EXPOSE 3123

CMD ["npm", "start"]
