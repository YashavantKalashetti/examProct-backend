ARG NODE_VERSION=20.8.0

FROM node:${NODE_VERSION}-alpine as base

WORKDIR /usr/src/app

FROM base as deps

RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM deps as build

RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci

# COPY . .
# RUN npm run build


FROM build as runtime


COPY . .
COPY --from=build /usr/src/app/ ./


# Expose the port that the application listens on.
EXPOSE 3000

# RUN npm install -g serve

# Serve the build files
CMD npm start



