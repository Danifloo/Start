FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .
EXPOSE 8000
# Keep one worker/replica and persistent DATA_DIR to prevent duplicate publications.
CMD ["sh","-c","exec uvicorn service:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
