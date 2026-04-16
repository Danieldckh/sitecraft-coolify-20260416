FROM node:20-alpine

WORKDIR /app

ENV PORT=3000

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps --ignore-scripts --include=dev
RUN ./node_modules/.bin/prisma generate

COPY public ./public
COPY src ./src
COPY next.config.ts tailwind.config.ts tsconfig.json next-env.d.ts postcss.config.mjs ./

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

# Ensure the SQLite schema exists before the app starts serving traffic.
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && npm run start"]
