# vg image: Node 22, production dependencies, ffmpeg-static, chrome-headless-shell, Be Vietnam Pro.
#
# ffmpeg comes from the ffmpeg-static package (postinstall downloads a static Linux
# binary inside this build). It is not apt's ffmpeg. ffprobe comes from ffprobe-static.
# The server prepends those directories to PATH when it renders.
#
# HyperFrames uses puppeteer-core plus @puppeteer/browsers. It stores chrome-headless-shell
# under HYPERFRAMES_CACHE_DIR (otherwise ~/.cache/hyperframes) and reads
# HYPERFRAMES_BROWSER_PATH / PRODUCER_HEADLESS_SHELL_PATH. `hyperframes browser ensure`
# installs the managed build at image build time so the container does not download it later.

FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV HYPERFRAMES_CACHE_DIR=/opt/hyperframes-cache \
    npm_config_update_notifier=false \
    CI=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    curl \
    unzip \
    fontconfig \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mcp/package.json apps/mcp/package.json

# The lockfile is written on Windows, so Rollup's Linux optional binary is named
# on the rollup package but has no resolved tarball entry. Install that one
# package inside the image. This does not change package.json or the lockfile.
RUN npm ci --no-audit --no-fund \
 && npm install --no-save --no-package-lock --no-audit --no-fund @rollup/rollup-linux-x64-gnu@4.67.4

COPY packages ./packages
COPY apps ./apps
COPY deploy/docker/entrypoint.sh /usr/local/bin/vg-entrypoint

RUN chmod +x /usr/local/bin/vg-entrypoint \
 && npm run build -w @vg/shared \
 && npm run build -w @vg/server \
 && npm run build -w @vg/web \
 && npm run build -w @vg/mcp

# SIL Open Font License. Variable font from the Google Fonts repo; static file is the fallback.
RUN mkdir -p /usr/local/share/fonts/be-vietnam-pro \
 && curl -fsSL -o /usr/local/share/fonts/be-vietnam-pro/OFL.txt \
      https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/OFL.txt \
 && (curl -fsSL -o /usr/local/share/fonts/be-vietnam-pro/BeVietnamPro.ttf \
      "https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro%5Bwght%5D.ttf" \
  || curl -fsSL -o /usr/local/share/fonts/be-vietnam-pro/BeVietnamPro-Regular.ttf \
      https://raw.githubusercontent.com/bettergui/BeVietnamPro/master/fonts/ttf/BeVietnamPro-Regular.ttf) \
 && fc-cache -f

RUN mkdir -p /opt/hyperframes-cache \
 && node node_modules/hyperframes/bin/hyperframes.mjs browser ensure \
 && chrome="$(node node_modules/hyperframes/bin/hyperframes.mjs browser path | tr -d '\r\n')" \
 && test -x "$chrome" \
 && "$chrome" --no-sandbox --disable-gpu --version

FROM build AS prod-deps

RUN npm prune --omit=dev && npm cache clean --force && rm -rf /root/.npm /tmp/*

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data \
    HYPERFRAMES_CACHE_DIR=/opt/hyperframes-cache \
    HOME=/home/vg \
    npm_config_update_notifier=false

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-liberation \
    gosu \
    python3 \
    python3-pip \
    python3-venv \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 vg \
 && useradd --system --uid 10001 --gid vg --create-home --home-dir /home/vg --shell /usr/sbin/nologin vg \
 && mkdir -p /data \
 && chown vg:vg /data

# edge-tts (TTS_PROVIDER default) is a Python CLI. Keep it in its own venv owned by uid 10001
# so the app user can upgrade it, and expose it on PATH where EDGE_TTS_PATH=edge-tts finds it.
RUN python3 -m venv /opt/edge-tts \
 && chown -R 10001:10001 /opt/edge-tts
USER 10001:10001
RUN /opt/edge-tts/bin/pip install --no-cache-dir edge-tts
USER root
RUN ln -s /opt/edge-tts/bin/edge-tts /usr/local/bin/edge-tts \
 && edge-tts --version

COPY --from=prod-deps /app /app
COPY --from=prod-deps /opt/hyperframes-cache /opt/hyperframes-cache
COPY --from=prod-deps /usr/local/share/fonts/be-vietnam-pro /usr/local/share/fonts/be-vietnam-pro
COPY --from=prod-deps /usr/local/bin/vg-entrypoint /usr/local/bin/vg-entrypoint

RUN fc-cache -f \
 && chown -R vg:vg /opt/hyperframes-cache /home/vg \
 && ffmpeg="$(node -e "process.stdout.write(require('ffmpeg-static'))")" \
 && probe="$(node -e "process.stdout.write(require('ffprobe-static').path)")" \
 && chmod +x "$ffmpeg" "$probe" \
 && "$ffmpeg" -version \
 && "$probe" -version \
 && chrome="$(node node_modules/hyperframes/bin/hyperframes.mjs browser path | tr -d '\r\n')" \
 && test -x "$chrome" \
 && "$chrome" --no-sandbox --disable-gpu --version \
 && test -f /usr/local/share/fonts/be-vietnam-pro/BeVietnamPro.ttf -o -f /usr/local/share/fonts/be-vietnam-pro/BeVietnamPro-Regular.ttf \
 && test -f /app/apps/web/dist/index.html \
 && test -f /app/apps/server/dist/index.js

VOLUME /data
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["vg-entrypoint"]
CMD ["node", "apps/server/dist/index.js"]
