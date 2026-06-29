# 시험 플랫폼 - API 서버 (Express + Prisma)
FROM node:20-slim

# Prisma 엔진은 openssl 이 필요합니다.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시)
COPY package*.json ./
RUN npm install

# 소스 복사 후 Prisma Client 생성
COPY . .
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# 기동 시 마이그레이션 적용 후 서버 실행
CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]
