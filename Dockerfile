FROM ubuntu:latest

# Install required dependencies
RUN apt-get update && \
    apt-get install -y curl unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json* /app/

RUN bun install

COPY . /app

EXPOSE 3000

CMD ["bun", "run", "dev"]