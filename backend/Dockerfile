FROM node:20-bookworm-slim

ENV NODE_ENV=production
# Chrome is installed by Puppeteer below, version-matched to the puppeteer
# release in package-lock.json. Do NOT switch back to Debian's `chromium`
# apt package: it is unpinned, so any image rebuild silently picks up
# whatever Debian ships that day. A rebuild on 2026-07-05 bumped chromium
# 149 -> 150, which Puppeteer 22.x (pinned to Chrome 127) could not launch,
# and every PDF render in production failed until this was replaced.
ENV PUPPETEER_CACHE_DIR=/app/.chrome

# Shared libraries Chrome needs on a -slim image (it is not an apt package,
# so nothing pulls these in for us).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
# Idempotent if the npm postinstall already downloaded it; guarantees the
# browser is present even if that step is ever skipped.
RUN npx puppeteer browsers install chrome

COPY src ./src

ENV PORT=5000

EXPOSE 5000

CMD ["npm", "start"]
