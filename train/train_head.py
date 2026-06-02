"""Train the Succubuster classifier head: a logistic-regression probe on frozen
CLIP image embeddings, exported to ONNX for in-browser use.

Honest evaluation on a tiny set: we report STRATIFIED K-FOLD cross-validated AUC
(not train accuracy), so the number reflects generalization. The head's real value
grows with the feedback data flywheel; this proves the pipeline trains, exports to
ONNX, and matches sklearn under onnxruntime.

Usage: python train/train_head.py  (reads eval/out/embeddings.json)
"""
import json
import os
import sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EMB = os.path.join(ROOT, "eval", "out", "embeddings.json")
OUT = os.path.join(ROOT, "extension", "models", "head")


def load():
    with open(EMB) as f:
        rows = json.load(f)
    X = np.array([r["embedding"] for r in rows], dtype=np.float32)
    y = np.array([r["label"] for r in rows], dtype=np.int64)
    cats = [r["category"] for r in rows]
    return X, y, cats, rows


def main():
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold, cross_val_predict
    from sklearn.metrics import roc_auc_score, classification_report

    if not os.path.exists(EMB):
        sys.exit(f"missing {EMB} — run `npx tsx eval/extract-embeddings.ts` first")

    X, y, cats, rows = load()
    print(f"loaded {len(y)} samples, dim {X.shape[1]}, positives {int(y.sum())}")

    # Strong L2 + balanced classes: the right priors for a 512-d probe on ~50 rows.
    clf = LogisticRegression(max_iter=5000, C=0.5, class_weight="balanced")

    # Honest generalization estimate.
    k = min(5, int(y.sum()))
    skf = StratifiedKFold(n_splits=k, shuffle=True, random_state=0)
    proba = cross_val_predict(clf, X, y, cv=skf, method="predict_proba")[:, 1]
    cv_auc = roc_auc_score(y, proba)
    print(f"\n{k}-fold CV AUC (trained head): {cv_auc:.3f}")
    print(classification_report(y, (proba > 0.5).astype(int), target_names=["benign", "bait"], digits=3))

    # Fit on everything for the shipped artifact.
    clf.fit(X, y)

    # Export to ONNX (zipmap off -> clean [N,2] probability tensor for onnxruntime-web).
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    onx = convert_sklearn(
        clf,
        initial_types=[("input", FloatTensorType([None, X.shape[1]]))],
        target_opset=18,
        options={id(clf): {"zipmap": False}},
    )
    os.makedirs(OUT, exist_ok=True)
    onnx_path = os.path.join(OUT, "succubuster_head.onnx")
    with open(onnx_path, "wb") as f:
        f.write(onx.SerializeToString())

    # Validate ONNX == sklearn within tolerance.
    import onnxruntime as ort

    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    out_names = [o.name for o in sess.get_outputs()]
    probs = sess.run(None, {"input": X})[out_names.index("probabilities") if "probabilities" in out_names else 1]
    onnx_p = np.array(probs)[:, 1]
    skl_p = clf.predict_proba(X)[:, 1]
    max_diff = float(np.max(np.abs(onnx_p - skl_p)))
    print(f"ONNX vs sklearn max prob diff: {max_diff:.2e}  ({'OK' if max_diff < 1e-4 else 'MISMATCH'})")

    manifest = {
        "backbone": "Xenova/clip-vit-base-patch32",
        "embed_dim": int(X.shape[1]),
        "head": "logreg",
        "C": 0.5,
        "class_weight": "balanced",
        "samples": int(len(y)),
        "positives": int(y.sum()),
        "cv_auc": round(cv_auc, 4),
        "opset": 18,
    }
    with open(os.path.join(OUT, "MANIFEST.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nwrote {onnx_path}")
    print(f"wrote {os.path.join(OUT, 'MANIFEST.json')}")


if __name__ == "__main__":
    main()
