# Checksum-pinned SDK dependency image for the native flight toolchain.
ARG MANTA_IMAGE=manta-app:full
FROM ${MANTA_IMAGE}
USER root
RUN test "$(dpkg --print-architecture)" = amd64 && apt-get update && apt-get install -y --no-install-recommends libboost-thread1.74.0 libboost-program-options1.74.0 libxerces-c3.2 && rm -rf /var/lib/apt/lists/*
COPY deploy/docker/nos3-sdk-manifest.json /opt/nos3-sdk/manifest.json
COPY deploy/docker/fetch-nos3-sdk.py /opt/nos3-sdk/fetch.py
RUN python3 /opt/nos3-sdk/fetch.py && dpkg -i /opt/nos3-sdk/*.deb && dpkg-query -L nos_engine itc-common | while IFS= read -r p; do case "$p" in /usr/*) if [ -e "$p" ]; then chmod a+rX "$p"; fi;; esac; done
RUN ldconfig && rm -f /opt/nos3-sdk/*.deb
USER 1000:1000
