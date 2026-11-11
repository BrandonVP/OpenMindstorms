#!/bin/sh
# Runs before nginx starts (nginx image entrypoint hook).  Creates a self-signed
# certificate for the Workbench, valid for the address in SERVER_IP and every name
# in SERVER_NAMES (comma separated), and keeps it in /certs so the trust you grant
# it once on your PC stays valid across rebuilds.  The certificate is regenerated
# whenever SERVER_IP / SERVER_NAMES change.
set -e
CERT_DIR=/certs
IP="${SERVER_IP:-192.168.68.208}"
NAMES="${SERVER_NAMES:-openrcx,truenas}"
SAN="IP:$IP"
for n in $(echo "$NAMES" | tr ',' ' '); do SAN="$SAN,DNS:$n"; done
mkdir -p "$CERT_DIR"
if [ ! -s "$CERT_DIR/server.crt" ] || [ ! -s "$CERT_DIR/server.key" ] || [ "$(cat "$CERT_DIR/san.txt" 2>/dev/null)" != "$SAN" ]; then
    echo "OpenMindstorms: generating self-signed certificate for $SAN"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
        -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
        -subj "/CN=OpenMindstorms" \
        -addext "subjectAltName=$SAN" \
        -addext "basicConstraints=CA:FALSE" \
        -addext "keyUsage=digitalSignature,keyEncipherment" \
        -addext "extendedKeyUsage=serverAuth"
    chmod 600 "$CERT_DIR/server.key"
    chmod 644 "$CERT_DIR/server.crt"
    echo "$SAN" > "$CERT_DIR/san.txt"
fi
