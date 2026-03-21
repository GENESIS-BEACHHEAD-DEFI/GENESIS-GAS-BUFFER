FROM node:20.20.0-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production=false
COPY . .
RUN npm run build
EXPOSE 8690
CMD ["node", "dist/index.js"]
