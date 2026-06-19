# ============================================
# Book Your Pitch — Dockerfile
# Deploy on Render: https://render.com
# ============================================
# Build:  docker build -t book-your-pitch .
# Run:    docker run -p 8000:8000 book-your-pitch
# ============================================

FROM python:3.11-slim

WORKDIR /app

# ── Install system dependencies ─────────────
# Python 3.11 has pre-built wheels for all deps — no gcc needed
# Add any system packages here if needed in the future
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# ── Install Python dependencies ─────────────
COPY booking-api/requirements.txt booking-api/
RUN pip install --no-cache-dir -r booking-api/requirements.txt

# ── Copy application code ───────────────────
# Preserve project structure so that os.path.join(__file__, "..", "booking-tool") works
COPY booking-api/ booking-api/
COPY booking-tool/ booking-tool/

# ── Runtime ─────────────────────────────────
WORKDIR /app/booking-api

EXPOSE 8000

# Render provides the $PORT env var automatically
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
