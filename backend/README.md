# WritersRoom Backend

FastAPI backend for the WritersRoom application.

## Setup

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up a PostgreSQL database named `writersroom` and update the connection string in `app/db/base.py` if needed.

## Running the Application

### Start the API Server

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

### Start the Background Worker (Required for AI Features)

The background worker processes AI script analysis tasks using RQ (Redis Queue).

```bash
./start_worker.sh
```

**macOS Note**: The `start_worker.sh` script includes `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` environment variable to prevent fork() crashes on macOS. This is required for the RQ worker to function properly.

**Requirements**:
- Redis server must be running (default: `redis://localhost:6379`)
- OpenAI API key must be configured in `.env`

To monitor worker activity:
```bash
tail -f /tmp/worker.log
```

## API Documentation

- Interactive API docs: `http://localhost:8000/docs`
- Alternative API docs: `http://localhost:8000/redoc`

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── routers/          # API route handlers
│   ├── models/           # Pydantic schemas
│   ├── db/               # Database configuration
│   │   ├── __init__.py
│   │   └── base.py
│   └── core/             # Core functionality
├── tests/                # Test files
├── main.py              # Application entry point
└── requirements.txt     # Dependencies
```

## API Endpoints

- `GET /api/health` - Health check endpoint
