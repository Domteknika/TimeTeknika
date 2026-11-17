"""Linux regression test: private umask must not make deployed code unreadable.
Run: python3 tests/release-permissions.py scripts/install-update.sh
"""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile

installer = Path(sys.argv[1]).read_text()
start = installer.index("import sys, tarfile")
end = installer.index("\nPY\n", start)
validator = installer[start:end]
with tempfile.TemporaryDirectory(prefix="timeteknika-permissions-") as temporary:
    root = Path(temporary)
    code = {
        "scripts/Dockerfile.release": b"FROM node:24",
        "dist/web/index.html": b"<html>test</html>",
        "dist/web/assets/chunk.js": b"export default 1;",
    }
    manifest = {"version": "permission-test", "frontend": "react",
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in code.items()}}
    code["scripts/release-manifest.json"] = json.dumps(manifest).encode()
    code["scripts/release-files.sha256"] = b"test fixture"
    archive = root / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, data in code.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o600
            tar.addfile(entry, io.BytesIO(data))
    stage = root / "stage"
    stage.mkdir(mode=0o700)
    secret = root / "backup.sqlite"
    secret.write_bytes(b"private backup")
    secret.chmod(0o600)
    subprocess.run([sys.executable, "-c", validator, str(archive), str(stage), "permission-test"],
                   check=True, umask=0o077)
    assert stat.S_IMODE(stage.stat().st_mode) == 0o700, "Private staging root was exposed"
    assert stat.S_IMODE(secret.stat().st_mode) == 0o600, "Backup permissions changed"
    for path in stage.rglob("*"):
        expected = 0o755 if path.is_dir() else 0o644
        assert stat.S_IMODE(path.stat().st_mode) == expected, str(path)
    print("PASS: restrictive umask, nested code, private staging and backup preserved")
