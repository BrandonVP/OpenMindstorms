# Optional accounts for OpenMindstorms (see server.py).  Standard library only;
# ca-certificates so the OAuth calls to Google and GitHub can verify TLS.
FROM python:3.12-alpine

RUN apk add --no-cache ca-certificates
COPY server.py /srv/server.py
RUN sed -i 's/\r$//' /srv/server.py && mkdir -p /data

ENV ACCOUNTS_DB=/data/accounts.db
EXPOSE 8083
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8083/api/auth').read()" || exit 1

CMD ["python3", "/srv/server.py"]
