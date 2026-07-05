FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY agent/package.json agent/
RUN npm install -w agent --no-fund --no-audit
COPY agent agent
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "agent/src/index.ts"]
