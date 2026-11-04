FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
RUN apk add --no-cache ffmpeg=8.1.3-r0
WORKDIR /opt/validator
COPY validate.mjs server.mjs ./
USER node
ENTRYPOINT ["node", "/opt/validator/validate.mjs"]
