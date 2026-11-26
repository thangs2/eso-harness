---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-OBS-02.md"
status: DRAFT
phase: 2
id: RTM-OBS-02
type: traceability-matrix
---

# RTM-OBS-02 — `/observatory/requests/:requestId`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-OBS-02-01` | `SCN-OBS-02-01` · `SCN-OBS-02-02` | `GET /api/v1/consumers/:id/requests/:requestId` | `platform.consumer` · `knowledge_observation` | `eso/ui/test/observatory-revamp.test.mjs` |
| `AC-OBS-02-02` | `SCN-OBS-02-03` · `SCN-OBS-02-04` | `GET /api/v1/consumers/:id/requests/:requestId` · `GET /api/v1/consumers/:id/requests/:requestId/receipt` · `GET /api/v1/consumers/:id/knowledge/sufficiency` | `knowledge_observation` · `platform.turn_verdict` · `platform.evidence_receipt` · `platform.scope_decision` | `eso/ui/test/observatory-revamp.test.mjs` |
| `AC-OBS-02-03` | `SCN-OBS-02-05` · `SCN-OBS-02-06` · `SCN-OBS-02-07` | `GET /api/v1/consumers/:id/requests/:requestId` · `GET /api/v1/consumers/:id/requests/:requestId/verdict` | `knowledge_observation` · `platform.turn_verdict` | `eso/control-plane/test/verdict.test.ts` · `eso/ui/test/observatory-revamp.test.mjs` |
| `AC-OBS-02-04` | `SCN-OBS-02-08` · `SCN-OBS-02-09` · `SCN-OBS-02-10` | `GET /api/v1/consumers/:id/requests/:requestId` · `GET /api/v1/consumers/:id/requests/:requestId/receipt` · `GET /api/v1/consumers/:id/knowledge/sufficiency` | `knowledge_observation` · `platform.evidence_receipt` · `platform.consumer_artifacts` | `eso/ui/test/turn-proof-sufficiency.test.mjs` · `eso/ui/test/observatory-revamp.test.mjs` |
| `AC-OBS-02-05` | `SCN-OBS-02-11` · `SCN-OBS-02-12` | `POST /api/v1/consumers/:id/observations` · `GET /api/v1/consumers/:id/requests/:requestId/receipt` · `GET /api/v1/consumers/:id/receipts/:receiptId/verify` | `knowledge_observation` · `platform.evidence_receipt` | `eso/control-plane/test/evidence-predicate.test.ts` · `eso/control-plane/test/receipt.test.ts` · `eso/ui/test/observatory-revamp.test.mjs` |
| `AC-OBS-02-06` | `SCN-OBS-02-13` · `SCN-OBS-02-14` | `GET /api/v1/consumers/:id/requests/:requestId` | `knowledge_observation` · `platform.turn_verdict` | `eso/ui/test/observatory-revamp.test.mjs` · `eso/ui/test/turn-proof-sufficiency.test.mjs` · `qc/eso-request-spec-ref.test.mjs` |
| `AC-OBS-02-07` | `SCN-OBS-02-15` · `SCN-OBS-02-16` · `SCN-OBS-02-17` | `GET /api/v1/consumers/:id/requests/:requestId` · `POST /api/v1/telemetry/ui` | `platform.turn_verdict` · `platform.ui_event` | `eso/ui/test/observatory-revamp.test.mjs` · `eso/control-plane/test/verdict.test.ts` |
| `AC-OBS-02-08` | `SCN-OBS-02-18` · `SCN-OBS-02-19` | `POST /api/v1/consumers/:id/observations` · `POST /api/v1/consumers/:id/judgment` | `knowledge_observation` · `knowledge_worker` | `eso/control-plane/test/judgment.service.test.ts` · `host-runtime/test/answer-collector.test.ts` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **8/8** |
| `SCN` | **19** (`18` automated + `1` rbac) |
| `AC` có test tồn tại trên đĩa | **8/8** (`MISSING = 0`) |
| `tenant` | `OUT` + lý do ([`SCN-OBS-02`](../03.scn/SCN-OBS-02.md) §2) |
| `rbac` | có (`SCN-OBS-02-16`) |
