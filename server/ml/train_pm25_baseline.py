"""Explicit offline CLI. Never imported/called by the HTTP server or worker."""
import argparse
import csv
import hashlib
import io
import json
import math
import platform
from pathlib import Path
from importlib.metadata import version
from urllib.request import urlopen
import zipfile

URL = "https://archive.ics.uci.edu/static/public/381/beijing%2Bpm2%2B5%2Bdata.zip"
ZIP_HASH = "40cdd29c24918e855133dce280ff59779bb0b5852898e05bafcf422a4cc0a175"
CSV_HASH = "4127f868775e31b3956522adc0ec75af8937dde6a3896e8beed3a376c6d27f1c"
RUNTIME = {"scikit-learn": "1.9.1", "numpy": "2.4.6", "scipy": "1.17.1", "joblib": "1.6.0", "threadpoolctl": "3.8.0"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    for dependency, expected in RUNTIME.items():
        if version(dependency) != expected:
            raise ValueError("Install requirements-pm25.txt in a separate environment")
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    source = directory / "source.zip"
    if not source.exists():
        with urlopen(URL, timeout=45) as response:
            content = response.read(8 * 1024 * 1024 + 1)
        if len(content) > 8 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != ZIP_HASH:
            raise ValueError("Source archive checksum mismatch")
        source.write_bytes(content)
    content = source.read_bytes()
    if hashlib.sha256(content).hexdigest() != ZIP_HASH:
        raise ValueError("Source archive checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        info = archive.getinfo("PRSA_data_2010.1.1-2014.12.31.csv")
        if info.file_size > 8 * 1024 * 1024:
            raise ValueError("Source CSV too large")
        data = archive.read(info)
    if hashlib.sha256(data).hexdigest() != CSV_HASH:
        raise ValueError("Source CSV checksum mismatch")
    train, holdout, missing = [], [], 0
    for row in csv.DictReader(io.StringIO(data.decode("utf-8"))):
        if row["pm2.5"] == "NA":
            missing += 1
            continue
        value = float(row["pm2.5"])
        if not math.isfinite(value) or value < 0:
            raise ValueError("Unexpected source PM2.5 value")
        (train if int(row["year"]) <= 2012 else holdout).append([value])
    import joblib
    import numpy as np
    from sklearn.ensemble import IsolationForest
    parameters = dict(n_estimators=100, max_samples=256, contamination="auto", max_features=1.0,
                      bootstrap=False, n_jobs=1, random_state=42, warm_start=False)
    model = IsolationForest(**parameters).fit(np.asarray(train, dtype=np.float64))
    artifact = directory / "isolation_forest.joblib"
    buffer = io.BytesIO()
    joblib.dump(model, buffer, compress=3, protocol=4)
    encoded = buffer.getvalue()
    if artifact.exists() and artifact.read_bytes() != encoded:
        raise ValueError("Refusing to overwrite a different artifact; use a new version directory")
    artifact.write_bytes(encoded)
    manifest = dict(id="pm25-iforest-uci381-v1", purpose="PM25-value-only-baseline-not-quality-validated",
                    filename=artifact.name, sha256=hashlib.sha256(encoded).hexdigest(), bytes=len(encoded),
                    features=["value"], unit="ug/m3", pythonVersion=platform.python_version(), sklearnVersion=RUNTIME["scikit-learn"], runtime=RUNTIME,
                    source=dict(url=URL, archiveSha256=ZIP_HASH, csvSha256=CSV_HASH,
                                citation="Chen, S. (2015). Beijing PM2.5. UCI. DOI 10.24432/C5JS49", license="CC BY 4.0"),
                    training=dict(parameters=parameters, reference="2010-2012 non-missing PM2.5; original row order",
                                  samples=len(train), missingRowsOmitted=missing, imputation=False),
                    holdout=dict(reference="2013-2014 non-missing PM2.5; never fitted", samples=len(holdout),
                                 flagged=int((model.predict(np.asarray(holdout)) == -1).sum()),
                                 quality="No anomaly labels: flagged count is not accuracy/precision/recall"))
    destination = Path(args.manifest)
    serialized = json.dumps(manifest, indent=2) + "\n"
    if destination.exists() and destination.read_text(encoding="utf-8") != serialized:
        raise ValueError("Refusing to overwrite a different manifest")
    destination.write_text(serialized, encoding="utf-8")
    print(json.dumps(dict(modelId=manifest["id"], sha256=manifest["sha256"], training=len(train), holdout=manifest["holdout"])))


if __name__ == "__main__":
    main()
