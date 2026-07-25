# Container/configuration evidence for the Python HTTP endpoint.
FROM python:3.13-slim
WORKDIR /fixture
COPY src/python ./src/python
EXPOSE 8000
CMD ["python3", "src/python/api.py"]
