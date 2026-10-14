FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY --from=frontend /app/dist ./dist
ENV HOST=0.0.0.0 PORT=8080 NOTES_DIR=/data/notes
VOLUME /data/notes
EXPOSE 8080
CMD ["node", "server.mjs"]
