FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm i --only=production || npm i
COPY . .
EXPOSE 8080
CMD ["node","server.js"]
