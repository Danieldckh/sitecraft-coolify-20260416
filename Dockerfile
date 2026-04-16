FROM node:20-alpine

WORKDIR /app

ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
COPY public ./public
COPY src ./src
COPY next.config.ts tailwind.config.ts tsconfig.json next-env.d.ts postcss.config.mjs ./

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

# Ensure the SQLite schema exists before the app starts serving traffic.
CMD ["sh", "-c", "npx prisma db push && npm run start"]
