ARG NOS3_NATIVE_IMAGE=manta-nos3-native-repro
FROM ${NOS3_NATIVE_IMAGE}
USER root
COPY vm /opt/manta/vm
COPY deploy/flight /opt/manta/deploy/flight
COPY deploy/runner /opt/manta/deploy/runner
COPY server/nos3 /opt/manta/server/nos3
COPY deploy/docker/nos3-sources.json /opt/manta/deploy/docker/nos3-sources.json
RUN mkdir -p /flight-control && chown 1000:1000 /flight-control
USER 1000:1000
RUN python3 /opt/manta/vm/worker/stf-low-power-prepare.py
ENV MANTA_FLIGHT_CONTAINER=1
CMD ["python3", "deploy/flight/service.py"]
