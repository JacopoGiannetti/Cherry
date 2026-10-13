# Immagine della dashboard analytics, non del backend pubblico.
# Cloud Run: Build type Dockerfile, percorso /backend/Dockerfile
# (il contesto di build è la cartella che lo contiene, cioè backend/).
FROM node:20-slim
WORKDIR /app

# ffmpeg: la sezione Distribution taglia, concatena, estrae fotogrammi e
# stampa i testi sui video. Senza, tutti i nodi che non sono una chiamata
# a fal falliscono all'avvio della run.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dashboard/server.js"]
