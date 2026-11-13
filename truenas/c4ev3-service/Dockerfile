# OpenEV3 C compile service: GCC for the EV3's ARM9 (the c4ev3 toolchain, static uClibc-ng,
# built for the brick's 2.6.33 kernel) plus the c4ev3 EV3-API library, behind a tiny HTTP server.
# POST C source to /api/c4ev3 and get back a static ELF that runs on the stock firmware.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils make python3 \
    && rm -rf /var/lib/apt/lists/*

# toolchain (GPL, from https://github.com/c4ev3/C4EV3.Toolchain/releases)
ARG TC_URL=https://github.com/c4ev3/C4EV3.Toolchain/releases/download/C4EV3.Toolchain-2019.08.0/C4EV3.Toolchain-v2019.08.0-arm-c4ev3-linux-uclibceabi-gcc-8.2.1-uclibc-ng-1.0.31-binutils-2.31.1-kernel-2.6.33-rc4-sanitized_linux-amd64.tar.xz
RUN mkdir -p /opt/tc && curl -fsSL "$TC_URL" | tar -xJ -C /opt/tc --strip-components=3 \
    && ls /opt/tc/bin | grep -q 'gcc$' \
    && ln -s "/opt/tc/bin/$(ls /opt/tc/bin | grep -- '-gcc$' | head -1)" /usr/local/bin/ev3-gcc \
    && ln -s "/opt/tc/bin/$(ls /opt/tc/bin | grep -- '-strip$' | head -1)" /usr/local/bin/ev3-strip \
    && ev3-gcc --version | head -1

# EV3-API (GPL-2, https://github.com/c4ev3/EV3-API): motors, sensors, LCD, sound, buttons for native programs
ARG API_URL=https://github.com/c4ev3/EV3-API/archive/refs/heads/master.tar.gz
RUN mkdir -p /opt/ev3api && curl -fsSL "$API_URL" | tar -xz -C /opt/ev3api --strip-components=1 \
    && PREFIX="/opt/tc/bin/$(ls /opt/tc/bin | grep -- '-gcc$' | head -1 | sed 's/gcc$//')" \
    && make -C /opt/ev3api CROSS_COMPILE="$PREFIX" libev3api.a \
    && ls -l /opt/ev3api/libev3api.a

COPY server.py /app/server.py
# build-time check: the example program must compile and link, or the image build fails loudly
RUN printf '#include <ev3.h>\nint main(void) { InitEV3(); LcdTextf(1, 0, LCD_LINE1, "hi %%d", 1); Wait(100); FreeEV3(); return 0; }\n' > /tmp/t.c \
    && python3 /app/server.py --check /tmp/t.c && rm /tmp/t.c

ENV PYTHONUNBUFFERED=1
EXPOSE 8084
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD curl -fsS http://localhost:8084/api/c4ev3 >/dev/null || exit 1
CMD ["python3", "/app/server.py"]
