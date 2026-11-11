# Usage counters for OpenMindstorms (see server.py).  Standard library only.
FROM python:3.12-alpine

COPY server.py /srv/server.py
RUN sed -i 's/\r$//' /srv/server.py && mkdir -p /data

ENV STATS_DB=/data/stats.db
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8082/api/stats').read()" || exit 1

CMD ["python3", "/srv/server.py"]
