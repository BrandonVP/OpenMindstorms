# OpenMindstorms (OpenRCX / OpenNXT / OpenEV3) as a static site behind nginx.
#
# Chrome and Edge only expose serial ports to pages served over HTTPS, so the
# container serves HTTPS with a self-signed certificate (generated on first start
# into /certs, which TrueNAS mounts from the openrcx dataset so it survives
# rebuilds) and redirects plain HTTP to it.
#
#   docker build -t openrcx:local .          (image/app name kept from the first deployment)
#   docker run -p 80:80 -p 443:443 -v ./certs:/certs -e SERVER_IP=192.168.68.208 openrcx:local

FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY truenas/nginx.conf /etc/nginx/conf.d/default.conf
COPY truenas/10-gen-cert.sh /docker-entrypoint.d/10-gen-cert.sh
# strip any CRLF a Windows checkout may have added, then make it executable
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-gen-cert.sh /etc/nginx/conf.d/default.conf \
    && chmod +x /docker-entrypoint.d/10-gen-cert.sh

# Only what the browser needs: the site, and the docs it links to.
COPY web/ /usr/share/nginx/html/
COPY docs/ /usr/share/nginx/html/docs/
# The DIY tower sketch, shown and downloaded by /rcx/tower/
COPY tower/ /usr/share/nginx/html/tower/
# Files copied onto the NAS share over SMB arrive owner-only (0600/0700) and COPY
# keeps those modes; nginx's worker runs as user "nginx", so open them up.
RUN chmod -R a+rX /usr/share/nginx/html
# Cache busting: Cloudflare and browsers cache .js/.css for hours, so every local script and
# stylesheet reference gets ?v=<hash of all scripts and stylesheets>, which changes exactly when
# they do. External URLs (with a scheme) are left alone.
RUN v=$(find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.css' \) | sort | xargs cat | md5sum | head -c 8) \
    && find /usr/share/nginx/html -name '*.html' -not -path '*/vendor/*' \
       -exec sed -i -E "s#(src|href)=\"([^\":?]+\.(js|css))\"#\1=\"\2?v=$v\"#g" {} + \
    && echo "assets versioned as ?v=$v"

ENV SERVER_IP=192.168.68.208

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
