"""Transport test double only; never an ML detector or an inference fallback."""
import json
import sys
import time
request = json.load(sys.stdin)
if request["mode"] == "sleep":
    time.sleep(2)
elif request["mode"] == "oversize":
    print("x" * 10000)
elif request["mode"] == "invalid":
    print("not-json")
elif request["mode"] == "failure":
    sys.stderr.write("secret model path and payload must not leak")
    print(json.dumps({"error": {"code": "unknown-private-code", "message": "private"}}))
    sys.exit(1)
else:
    print(json.dumps({"ok": True}))
