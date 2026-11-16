"""Fetch only the reviewed upstream revision; never execute downloaded source code."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[2]
manifest = json.loads((Path(__file__).parent / "artifact-manifest.json").read_text())
target = root / ".local" / "models" / manifest["id"] / manifest["filename"]
url = f'{manifest["source"]}/resolve/{manifest["revision"]}/{manifest["filename"]}'
with urlopen(url, timeout=30) as response:
    content = response.read(manifest["bytes"] + 1)
if len(content) != manifest["bytes"] or hashlib.sha256(content).hexdigest() != manifest["sha256"]:
    raise RuntimeError("Upstream artifact does not match the pinned manifest")
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != manifest["sha256"]:
    raise RuntimeError("Refusing to overwrite a different local artifact")
target.write_bytes(content)
print(json.dumps({"artifact": str(target), "sha256": manifest["sha256"], "bytes": len(content)}))
