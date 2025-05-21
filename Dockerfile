FROM oven/bun:latest

WORKDIR /app

COPY package.json package-lock.json* /app/

RUN bun install

COPY . /app

EXPOSE 3000

CMD ["bun", "run", "dev"]
