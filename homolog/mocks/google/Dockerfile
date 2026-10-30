# Dublê de homologação: Node puro, sem dependência. node:20-alpine já está na
# máquina (o pull do docker.io falha às vezes aqui).
FROM node:20-alpine
WORKDIR /srv
COPY server.mjs .
ENV PORT=4021
EXPOSE 4021
CMD ["node", "server.mjs"]
