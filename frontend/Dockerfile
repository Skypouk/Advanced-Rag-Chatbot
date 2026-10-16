FROM node:20-alpine

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package.json package-lock.json ./
RUN npm ci && md5sum package-lock.json > node_modules/.lock.md5

COPY . .

EXPOSE 5173

# docker-compose mounts node_modules as a volume, which survives image rebuilds.
# Reinstall when package-lock.json no longer matches what that volume holds,
# then start the Vite dev server (hot reload; /api is proxied to the backend).
CMD ["sh", "-c", "md5sum -c -s node_modules/.lock.md5 2>/dev/null || { echo 'Dependencies changed, running npm ci...'; npm ci && md5sum package-lock.json > node_modules/.lock.md5; }; exec npm run dev -- --host 0.0.0.0"]
