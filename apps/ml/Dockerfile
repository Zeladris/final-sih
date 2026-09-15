# KisanSetu ML inference service (§9, §10, §47).
#
# The model artifacts are built INTO the image: the trainer runs at build
# time, so a container starts by loading files, never by training (§46).
# The same image runs on a laptop via docker compose and in a cloud container
# runtime — nothing in it is tied to one machine, and it holds no secrets.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first: this layer is cached until requirements.txt changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY training ./training

# Build the development model artifacts. Training happens HERE, once, at
# build — never on startup and never per request.
RUN python -m training.train

# Non-root at runtime.
RUN useradd --create-home --uid 10001 mlservice && chown -R mlservice:mlservice /app
USER mlservice

EXPOSE 8000

# The service is internal: the API server reaches it, the internet does not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
