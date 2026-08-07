import multiprocessing
import os
from pathlib import Path
import shutil
import sys
import uvicorn


def purge_user_data() -> int:
    from keyring import delete_password
    try:
        delete_password("SHREE Desktop AI", "GEMINI_API_KEY")
    except Exception:
        pass
    data_dir = Path(os.environ.get("DATA_DIR", Path.home() / "AppData" / "Local" / "SHREE"))
    shutil.rmtree(data_dir, ignore_errors=True)
    return 0

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if "--purge-user-data" in sys.argv:
        raise SystemExit(purge_user_data())
    from shree.main import app
    uvicorn.run(app, host=os.environ.get("SHREE_BACKEND_HOST", "127.0.0.1"), port=int(os.environ.get("SHREE_BACKEND_PORT", "8765")), log_level="info")
