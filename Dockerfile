FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

# 数据目录（compose 里会挂载 ./data 覆盖它；直接 docker run 时也可用 -v 挂载）
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["python", "server.py"]
