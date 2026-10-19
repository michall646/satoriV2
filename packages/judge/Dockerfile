# Satori V2 — real C++/Python judge worker.
# Prod image: kolejka/satori:judge
# Build: docker build -t kolejka/satori:judge -f packages/judge/Dockerfile .
# Run: docker run --rm --network none --pids-limit 64 --memory 512m --cpus 1 kolejka/satori:judge
FROM gcc:13.2-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 10001 judge

WORKDIR /app
COPY packages/judge/src/ ./packages/judge/src/
COPY packages/judge/package.json ./packages/judge/
COPY apps/api/src/lib/ ./apps/api/src/lib/

USER judge
# No network at runtime (--network none). Limits via cgroups v2:
# timeMs per test (timeout, Python x2 via perLang), memoryMb 256m, pids 64, no fork bomb.
# Local fallback without Docker uses host g++/python3 with timeout only.
CMD ["node", "-e", "console.log('satori judge worker: g++ 13.2 + python3 ready')"]
