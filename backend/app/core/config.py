from pydantic_settings import BaseSettings
from functools import lru_cache
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Settings(BaseSettings):
    # Database settings
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "5432")
    DB_NAME: str = os.getenv("DB_NAME", "writersroom")
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASS: str = os.getenv("DB_PASSWORD", "postgres")

    # AI API Keys
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

    # Redis settings (for background jobs and real-time collaboration)
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

    # AI System Configuration
    # State transition thresholds
    EMPTY_TO_PARTIAL_MIN_SCENES: int = int(os.getenv("EMPTY_TO_PARTIAL_MIN_SCENES", "3"))
    EMPTY_TO_PARTIAL_MIN_PAGES: int = int(os.getenv("EMPTY_TO_PARTIAL_MIN_PAGES", "10"))
    PARTIAL_TO_ANALYZED_MIN_SCENES: int = int(os.getenv("PARTIAL_TO_ANALYZED_MIN_SCENES", "30"))
    PARTIAL_TO_ANALYZED_MIN_PAGES: int = int(os.getenv("PARTIAL_TO_ANALYZED_MIN_PAGES", "60"))

    # Staleness thresholds
    OUTLINE_STALE_THRESHOLD: int = int(os.getenv("OUTLINE_STALE_THRESHOLD", "5"))  # scenes changed
    CHARACTER_STALE_THRESHOLD: int = int(os.getenv("CHARACTER_STALE_THRESHOLD", "3"))  # scenes with character changed

    # Token budgets (for Claude API)
    BUDGET_QUICK_TOKENS: int = int(os.getenv("BUDGET_QUICK_TOKENS", "1200"))
    BUDGET_STANDARD_TOKENS: int = int(os.getenv("BUDGET_STANDARD_TOKENS", "5000"))
    BUDGET_DEEP_TOKENS: int = int(os.getenv("BUDGET_DEEP_TOKENS", "20000"))

    # Conversation summary trigger
    CONVERSATION_SUMMARY_MESSAGE_THRESHOLD: int = int(os.getenv("CONVERSATION_SUMMARY_MESSAGE_THRESHOLD", "15"))

    # Construct the database URL
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASS}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "allow"  # Allow extra fields from .env that aren't defined in Settings

@lru_cache()
def get_settings() -> Settings:
    return Settings()

# Create settings instance
settings = get_settings()
