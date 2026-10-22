# Dublê de homologação da Evolution (produção 22C): Node puro, sem dependência.
# node:20-alpine já está na máquina (o pull do docker.io falha às vezes aqui).
FROM node:20-alpine
WORKDIR /srv
COPY server.mjs .
EXPOSE 8080
CMD ["node", "server.mjs"]
