FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY demo-app/package.json demo-app/
RUN npm install -w demo-app --no-fund --no-audit
COPY demo-app demo-app
ENV PORT=8081
EXPOSE 8081
CMD ["npx", "tsx", "demo-app/src/index.ts"]
