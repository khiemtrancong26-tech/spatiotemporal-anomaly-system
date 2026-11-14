"""Inference-only protocol. Artifact/manifest paths are operator configuration, never HTTP input."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import warnings
from importlib.metadata import version


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--artifact", required=True)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    if version("scikit-learn") != manifest["sklearnVersion"]:
        raise ValueError("MODEL_RUNTIME_MISMATCH")
    for dependency, expected in manifest["runtime"].items():
        if version(dependency) != expected:
            raise ValueError("MODEL_RUNTIME_MISMATCH")
    path = Path(args.artifact)
    if path.stat().st_size != manifest["bytes"]:
        raise ValueError("MODEL_INTEGRITY_ERROR")
    with path.open("rb") as source:
        content = source.read(manifest["bytes"] + 1)
    if len(content) != manifest["bytes"] or hashlib.sha256(content).hexdigest() != manifest["sha256"]:
        raise ValueError("MODEL_INTEGRITY_ERROR")
    request = json.load(sys.stdin)
    if set(request) != {"protocol", "features", "rows"} or request["protocol"] != 1 or request["features"] != manifest["features"]:
        raise ValueError("FEATURE_SCHEMA_MISMATCH")
    rows = request["rows"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("INVALID_FEATURES")
    ids = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"readingId", "values"} or not isinstance(row["readingId"], str) or not row["readingId"] or row["readingId"] in ids:
            raise ValueError("INVALID_FEATURES")
        ids.add(row["readingId"])
        if not isinstance(row["values"], list) or len(row["values"]) != len(manifest["features"]):
            raise ValueError("INVALID_FEATURES")
        if any(isinstance(value, bool) or not isinstance(value, (float, int)) for value in row["values"]):
            raise ValueError("INVALID_FEATURES")
    import joblib
    import numpy as np
    from sklearn.pipeline import Pipeline
    from sklearn.ensemble import IsolationForest

    matrix = np.asarray([row["values"] for row in rows], dtype=np.float64)
    if not np.isfinite(matrix).all() or (np.abs(matrix) > np.finfo(np.float32).max).any():
        raise ValueError("INVALID_FEATURES")
    # This loader is for the explicitly selected/pinned trusted-source artifact.
    # Hash is integrity, not permission to load arbitrary pickle uploads.
    warnings.filterwarnings("error", message="Trying to unpickle estimator.*")
    model = joblib.load(io.BytesIO(content))
    estimator = model.steps[-1][1] if isinstance(model, Pipeline) else model
    if not isinstance(estimator, IsolationForest) or model.n_features_in_ != len(manifest["features"]):
        raise ValueError("MODEL_TYPE_MISMATCH")
    labels = model.predict(matrix)
    decisions = model.decision_function(matrix)
    scores = model.score_samples(matrix)
    if not np.isfinite(decisions).all() or not np.isfinite(scores).all():
        raise ValueError("INVALID_MODEL_OUTPUT")
    output = {"protocol": 1, "modelId": manifest["id"], "sklearnVersion": version("scikit-learn"), "points": [
        {"readingId": row["readingId"], "prediction": int(label), "decisionFunction": float(decision), "scoreSamples": float(score)}
        for row, label, decision, score in zip(rows, labels, decisions, scores)
    ]}
    print(json.dumps(output, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        known = {"MODEL_RUNTIME_MISMATCH", "MODEL_INTEGRITY_ERROR", "FEATURE_SCHEMA_MISMATCH", "INVALID_FEATURES", "MODEL_TYPE_MISMATCH", "INVALID_MODEL_OUTPUT"}
        code = str(error) if str(error) in known else "MODEL_UNAVAILABLE"
        print(json.dumps({"error": {"code": code, "message": "Inference did not complete."}}))
        sys.exit(1)
