FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY M2_Publisher_GitHub.tar.xz /tmp/m2-source.tar.xz
RUN python -c "import tarfile; t=tarfile.open('/tmp/m2-source.tar.xz','r:xz'); t.extractall('/tmp/m2-source',filter='data'); t.close()" \
 && cp -a /tmp/m2-source/M2_Publisher/. /app/ \
 && pip install --no-cache-dir -r requirements.txt \
 && rm -rf /tmp/m2-source /tmp/m2-source.tar.xz
EXPOSE 8000
# SQLite scheduler must run as a single process and use persistent DATA_DIR.
CMD ["sh","-c","exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
