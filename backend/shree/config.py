from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
import keyring


class Settings(BaseSettings):
    app_name: str = "Shree — Mark 12"
    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = 8765
    # Use Google's current low-latency Live model first, matching the original
    # v1.1.20 connection order. Keep 2.5 native audio as the quota fallback.
    gemini_live_model: str = "gemini-3.1-flash-live-preview"
    gemini_live_fallback_model: str = "gemini-2.5-flash-native-audio-latest"
    data_dir: Path = Path.home() / "AppData" / "Local" / "SHREE"
    log_level: str = "INFO"
    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173,null"
    backend_token: str | None = None
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore")

    @property
    def database_path(self) -> Path:
        return self.data_dir / "shree.db"

    @property
    def origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    def resolved_gemini_api_key(self) -> str | None:
        try:
            # Secrets are accepted only through SHREE Settings and live in the
            # current Windows user's Credential Manager. Environment files are
            # deliberately not an API-key source for the desktop application.
            return keyring.get_password("SHREE Desktop AI", "GEMINI_API_KEY")
        except Exception:
            return None


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "logs").mkdir(exist_ok=True)
    (settings.data_dir / "plugins").mkdir(exist_ok=True)
    return settings
