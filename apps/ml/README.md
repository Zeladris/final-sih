# KisanSetu ML service

Advisory produce-quality inference. Inference only: no database, no business
rules, no queue decisions. Those belong to `apps/api`.

## Run

With Docker, from the repository root — this trains the models during the image
build, so the container starts ready:

```powershell
docker compose up ml
```

Or standalone:

```powershell
cd apps/ml
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m training.train          # writes the model artifacts
.venv\Scripts\python -m uvicorn app.main:app --port 8001
```

Then set `ML_SERVICE_URL` in the root `.env` (`http://localhost:8001`
standalone, `http://ml:8000` under compose) and restart the API. Without it,
quality is assessed manually and the queue runs on deterministic processing
estimates. Nothing is blocked.

## Models are artifacts, loaded once

`training/train.py` fits each crop family and writes a joblib artifact to
`app/models/artifacts/`. The service **loads** those at startup and holds them
process-wide — it never trains per request, and never reloads per request.

If an artifact is missing the service says so loudly and trains once so that a
forgotten build step degrades into a slow first start rather than an outage.
That is a safety net, not the intended path; the Docker image trains at build.

Artifacts are build output: they are not committed, and `.dockerignore` keeps a
stale local copy out of the image.

## The endpoint

`POST /predict/quality`, `multipart/form-data`:

| Field | Required | Notes |
| --- | --- | --- |
| `photo` | yes | JPEG or PNG |
| `crop_id` | yes | Unknown crops are refused, not guessed |
| `quantity_kg` | yes | |
| `storage_duration_days` | no | How long since harvest |
| `storage_type` | no | `OPEN` · `COVERED` · `WAREHOUSE` · `OTHER` |
| `temperature_c` `humidity_percent` `rainfall_recent_mm` | no | Weather at the storage location |

No farmer identity is sent. The service receives a photo, a crop, a quantity and
storage/weather context — nothing that names anybody.

## Storage and weather only ever add caution

The context fields adjust the result in **one direction**: they can lower the
score, lower the confidence and raise the risk band, never the reverse. Produce
stored badly for a month cannot come out looking better than the photo. The
adjustment is bounded (at most 12 score points and 0.10 confidence) so context
can shade a result but cannot manufacture one, and the response states which
factors applied.

Fresh produce with good storage receives no penalty at all — there is a test for
each of those two properties.

## What the model is and is not

- **Is:** a crop-aware (paddy / cereal / pulse-oilseed) classifier over simple,
  inspectable image statistics, returning risk, confidence, reason codes and a
  processing hint.
- **Is not:** a validated grading model. It is trained on **synthetic
  development data** (`trainingData: "SYNTHETIC_DEVELOPMENT"` on every response)
  because no labelled produce photographs are available. No accuracy figure is
  claimed, here or in the interface.
- Confidence is reduced for dark, tiny or unfamiliar photos and never inflated.
- Unknown crops are refused (`422 UNSUPPORTED_CROP`), not guessed.

Replacing `app/models/quality/dev_training.py` with training on real labelled
samples is the upgrade path; the API contract does not change.

## Test

```powershell
.venv\Scripts\python -m pytest -q
```
