"""One explicit offline fit from the shared TypeScript builder's three-column matrix."""
import argparse
import csv
import hashlib
import io
import json
import platform
from pathlib import Path
from importlib.metadata import version

RUNTIME = {"scikit-learn": "1.9.1", "numpy": "2.4.6", "scipy": "1.17.1", "joblib": "1.6.0", "threadpoolctl": "3.8.0"}
FEATURES = ["value", "temporal_delta", "spatial_delta"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--features-dir", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--manifest", required=True)
    args = p.parse_args()
    if any(version(k) != v for k, v in RUNTIME.items()):
        raise ValueError("Use the existing pinned PM2.5 runtime")
    directory, output, manifest_path = Path(args.features_dir), Path(args.output_dir), Path(args.manifest)
    artifact = output / "isolation_forest.joblib"
    if artifact.exists() or manifest_path.exists():
        raise ValueError("Refusing to refit/overwrite an existing v2 artifact or manifest")
    provenance = json.loads((directory / "features.json").read_text(encoding="utf-8"))
    import numpy as np
    import joblib
    from sklearn.ensemble import IsolationForest

    def matrix(name):
        data = (directory / (name + ".csv")).read_bytes()
        if hashlib.sha256(data).hexdigest() != provenance[name]["sha256"]:
            raise ValueError("Feature matrix hash mismatch")
        reader = csv.DictReader(io.StringIO(data.decode("utf-8")))
        if reader.fieldnames != ["readingId"] + FEATURES:
            raise ValueError("Feature order mismatch")
        result = np.asarray([[float(r[f]) for f in FEATURES] for r in reader], dtype=np.float64)
        if result.shape != (provenance[name]["summary"]["scoredCount"], 3) or not np.isfinite(result).all():
            raise ValueError("Invalid feature matrix")
        return result

    train, holdout = matrix("train"), matrix("holdout")
    parameters = dict(n_estimators=100, max_samples=256, contamination="auto", max_features=1.0,
                      bootstrap=False, n_jobs=1, random_state=42, warm_start=False)
    model = IsolationForest(**parameters).fit(train)  # The only fit; no tuning or fit on holdout/golden.
    buffer = io.BytesIO()
    joblib.dump(model, buffer, compress=3, protocol=4)
    encoded = buffer.getvalue()
    manifest = dict(id="pm25-iforest-uci501-v2", purpose="three-feature-integration-baseline-not-quality-validated",
                    filename=artifact.name, sha256=hashlib.sha256(encoded).hexdigest(), bytes=len(encoded), features=FEATURES,
                    unit="ug/m3", pythonVersion=platform.python_version(), sklearnVersion=RUNTIME["scikit-learn"], runtime=RUNTIME,
                    policyId=provenance["featurePolicy"]["id"], featurePolicy=provenance["featurePolicy"], featurePolicySha256=provenance["featurePolicySha256"],
                    featureBuilderSha256=provenance["featureBuilderSha256"], source=provenance["source"],
                    training=dict(parameters=parameters, **provenance["train"]),
                    holdout=dict(**provenance["holdout"], flagged=int((model.predict(holdout) == -1).sum()), quality="No anomaly labels; not accuracy/precision/recall"),
                    golden=provenance["golden"])
    output.mkdir(parents=True, exist_ok=True)
    with artifact.open("xb") as f:
        f.write(encoded)
    with manifest_path.open("x", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(dict(modelId=manifest["id"], sha256=manifest["sha256"], features=FEATURES, training=manifest["training"]["summary"], holdout=manifest["holdout"]["summary"])))


if __name__ == "__main__":
    main()
