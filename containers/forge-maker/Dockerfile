# The Make-from-words maker: scripts/forge_optimizer_daemon.py, unchanged, in the Python environment it was measured in.
# Context = ./context (stage.mjs fills it). Build with --platform linux/amd64 (Cloudflare Containers; wrangler does this).
# requirements.txt is the pip freeze of parts/partspec/.venv (2026-11-04), the environment the 40-wish runs and the print gates were checked in.
# (A first version listed only the packages I had spotted and left out matplotlib: the fast preview worked and the print check failed.)
FROM python:3.9-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FORGE_OPTIMIZER_OUT_DIR=/data/forge-cache

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

RUN useradd --create-home --uid 10001 maker
WORKDIR /app
COPY . /app/
# The daemon keeps its artifacts in /data/forge-cache, and the print check leaves short-lived files in parts/partspec/out.
RUN mkdir -p /data/forge-cache /app/parts/partspec/out && chown -R maker:maker /data /app/parts/partspec/out
USER maker

EXPOSE 8791
# FORGE_OPTIMIZER_TOKEN arrives as an environment variable from the Worker; the daemon refuses a non-loopback bind without it.
CMD ["python", "scripts/forge_optimizer_daemon.py", "--host", "0.0.0.0", "--port", "8791"]
