# NXC compile service for OpenNXT.
#
# The NXC/NBC compiler is a native program (no browser build exists), so the
# Workbench sends source here and gets an .rxe back.  Debian packages the
# compiler, which keeps this image tiny and reproducible.

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends nbc python3 \
    && rm -rf /var/lib/apt/lists/*

COPY server.py /srv/server.py
RUN sed -i 's/\r$//' /srv/server.py

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8081/api/nxc').read()" || exit 1

CMD ["python3", "/srv/server.py"]
