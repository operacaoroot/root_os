# Dublê de homologação: Node puro, sem dependência. node:20-alpine já está na
# máquina (o pull do docker.io falha às vezes aqui).
FROM node:20-alpine
WORKDIR /srv
COPY server.mjs .
VOLUME ["/data"]
CMD ["node", "server.mjs"]
