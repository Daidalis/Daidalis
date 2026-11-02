# Pinned native toolchain build stage for the dedicated flight service.
ARG NOS3_SDK_IMAGE=manta-nos3-sdk
FROM ${NOS3_SDK_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake file libboost-dev libboost-system-dev libboost-program-options-dev libboost-filesystem-dev libboost-thread-dev libboost-regex-dev libxerces-c-dev libelf-dev libncurses-dev libreadline-dev libsocketcan-dev && rm -rf /var/lib/apt/lists/*
COPY deploy/docker/nos3-sources.json /opt/nos3-build/sources.json
COPY deploy/docker/fetch-nos3-sources.py deploy/docker/configure-nos3-container.py /opt/nos3-build/
RUN --mount=type=cache,target=/var/cache/manta-nos3,id=manta-nos3-sources,sharing=locked python3 /opt/nos3-build/fetch-nos3-sources.py
COPY vm/nos3-plan/configure_native.py vm/nos3-plan/build_native.sh /opt/nos3-build/
RUN ln -sf /usr/lib/libnos_engine_client.so /usr/lib/libnos_engine_client_cxx11.so && python3 /opt/nos3-build/configure-nos3-container.py && MANTA_BUILD_JOBS=4 bash /opt/nos3-build/build_native.sh /srv/manta/nos3
COPY vm /opt/manta/vm
RUN chown -R 1000:1000 /srv/manta
USER 1000:1000
CMD ["python3", "vm/nos3-plan/run_native.py", "--output", "/srv/manta/runs/smoke", "--duration", "20"]
