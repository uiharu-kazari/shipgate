FROM node:24-slim
WORKDIR /app

# Copy the lockfile when one exists so the build can use a reproducible `npm ci`.
# Both workspace manifests are needed for npm to resolve the workspace tree.
COPY package.json ./
COPY package-lock.json* ./
COPY agent/package.json agent/
COPY demo-app/package.json demo-app/

# tsx is a devDependency and the app runs TypeScript through it at runtime,
# so dev dependencies must stay installed (no --omit=dev).
RUN if [ -f package-lock.json ]; then \
      npm ci -w demo-app --no-fund --no-audit; \
    else \
      npm install -w demo-app --no-fund --no-audit; \
    fi

COPY demo-app demo-app

# Run as an unprivileged user (node:24-slim ships a `node` user).
RUN chown -R node:node /app
USER node

ENV PORT=8081
EXPOSE 8081
CMD ["npx", "tsx", "demo-app/src/index.ts"]
