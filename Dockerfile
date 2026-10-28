# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
FROM ${NODE_IMAGE} AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 git tini && rm -rf /var/lib/apt/lists/*

FROM base AS tools
# Comma-separated, validated by the installer. Omit groups to save actual image space.
ARG TOOLCHAINS=scipy,ngspice,openscad,browser,desktop,gis
COPY deploy/docker/install-tools.sh /opt/install-tools.sh
RUN TOOLCHAINS="$TOOLCHAINS" sh /opt/install-tools.sh
ARG WITH_MODELICA=1
ARG MODELICA_VERSION=1.27.1-1
COPY deploy/docker/install-modelica.sh /opt/install-modelica.sh
COPY deploy/docker/fetch-modelica.py /opt/fetch-modelica.py
RUN --mount=type=cache,target=/var/cache/apt,id=manta-modelica-packages,sharing=locked WITH_MODELICA="$WITH_MODELICA" MODELICA_VERSION="$MODELICA_VERSION" sh /opt/install-modelica.sh
COPY deploy/runner/worker.py /opt/runner/worker.py
RUN dpkg-query -W > /opt/runner/packages.txt

FROM base AS native-agents
ARG CODEX_VERSION=0.164.0
RUN npm install --global --prefix /opt/codex --no-audit --no-fund "@openai/codex@${CODEX_VERSION}" && npm cache clean --force

FROM base AS orbit42-build
ARG WITH_ORBIT42=1
COPY deploy/docker/build-orbit42.py /opt/build-orbit42.py
COPY vm/worker/orbit42-run.py /opt/orbit42-reference.py
RUN --mount=type=cache,target=/var/cache/manta42,id=manta-orbit42-source,sharing=locked mkdir -p /opt/orbit42 && if [ "$WITH_ORBIT42" = 1 ]; then apt-get update && apt-get install -y --no-install-recommends build-essential && python3 /opt/build-orbit42.py; elif [ "$WITH_ORBIT42" != 0 ]; then exit 2; fi

# Only the broker image contains a Docker client; applications/tasks never get a socket.
FROM docker:29.4.1-cli@sha256:17b5c235f40be7432a7c0914c154e9278aed63bad4afe5607e4f91840696a9f8 AS docker-client
FROM base AS broker
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
COPY deploy/runner/broker.py /opt/broker.py
COPY deploy/runner/native-broker.py /opt/native-broker.py
RUN mkdir /broker-control && chown 1000:1000 /broker-control
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "-B", "/opt/broker.py"]

FROM tools AS application
WORKDIR /opt/manta
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY --from=native-agents /opt/codex /opt/codex
COPY --from=orbit42-build /opt/orbit42 /opt/orbit42
COPY . ./
RUN mkdir -p /data /projects /control /desktop-control /desktop-data /model-control /task-home && chown -R 1000:1000 /data /projects /control /desktop-control /desktop-data /model-control /task-home
ENV HOME=/home/node MBSE_DATA_DIR=/data MBSE_PYTHON=/usr/bin/python3
ENV PATH="/opt/codex/bin:${PATH}"
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "deploy/docker/entrypoint.mjs"]
