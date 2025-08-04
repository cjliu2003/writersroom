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

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

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
