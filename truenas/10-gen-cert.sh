#!/bin/sh
# Runs before nginx starts (nginx image entrypoint hook).  Creates a self-signed
# certificate for the Workbench the first time, valid for the NAS address in
# SERVER_IP, and keeps it in /certs so the browser exception you accept once
# stays valid across rebuilds.
set -e
CERT_DIR=/certs
IP="${SERVER_IP:-192.168.68.208}"
mkdir -p "$CERT_DIR"
if [ ! -s "$CERT_DIR/server.crt" ] || [ ! -s "$CERT_DIR/server.key" ]; then
    echo "OpenRCX: generating self-signed certificate for $IP"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
        -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
        -subj "/CN=OpenRCX Workbench" \
        -addext "subjectAltName=IP:$IP,DNS:truenas,DNS:openrcx" \
        -addext "basicConstraints=CA:FALSE" \
        -addext "keyUsage=digitalSignature,keyEncipherment" \
        -addext "extendedKeyUsage=serverAuth"
    chmod 600 "$CERT_DIR/server.key"
fi
