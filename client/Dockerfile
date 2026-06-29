# 시험 플랫폼 - 프론트엔드 (Vite 빌드 → nginx 정적 서빙)
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# VITE_API_URL 은 비워둡니다. 브라우저는 상대경로 /api 로 호출하고
# nginx 가 같은 오리진에서 server 컨테이너로 프록시합니다.
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
