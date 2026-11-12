ARG NOS3_NATIVE_IMAGE=daidalis-nos3-native-repro
FROM ${NOS3_NATIVE_IMAGE}
USER root
COPY vm /opt/daidalis/vm
COPY deploy/flight /opt/daidalis/deploy/flight
COPY deploy/runner /opt/daidalis/deploy/runner
COPY server/nos3 /opt/daidalis/server/nos3
COPY deploy/docker/nos3-sources.json /opt/daidalis/deploy/docker/nos3-sources.json
RUN mkdir -p /flight-control && chown 1000:1000 /flight-control
USER 1000:1000
RUN python3 /opt/daidalis/vm/worker/stf-low-power-prepare.py
ENV DAIDALIS_FLIGHT_CONTAINER=1
CMD ["python3", "deploy/flight/service.py"]
