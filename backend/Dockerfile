FROM node:18-alpine

WORKDIR /app

# Dependencias del sistema para better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --production

COPY . .

# Crear directorio de datos
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
