Original prompt: 게시 완료된 시뮬레이션의 렌더링·구조·시뮬레이션 디테일을 순차적으로 고도화한다.

## 2026-10-02 — detail refinement

Baseline: public v1.3.0 source a4b1284. Work occurs in an isolated clone.

- Preserve quasi-static controlled-speed model and saved comparison records.
- Improve actual internal involute tooth surfaces and distinguish ground flanks from turned end faces.
- Correct final-drive half-tooth phase. Existing 30-degree-offset planetary phases are correct.
- Tie bearing cage and ball rotation to displayed bearing geometry with no-slip contact checks.
- Expose per-component slip, heat, mesh passage, belt and planetary reaction details. Values must be derived from the same snapshot as the main readouts.
- Verify existing model/geometry/project suites, build, browser/consumer/scene tests, new detail regression checks, desktop compatibility, and screenshots.

Validation results and remaining work will be appended as checks finish.


Completed first detail pass: internal involute correction, ground/turned surface separation, final/reverse phases, grooved bearing races with creased normals, instanced ball spin, selected-component isolated inspection, same-bearing DCT readouts, snapshot-derived detail rows. Closed original regression suites; 65 numerical/geometry/project checks, 23 browser, 12 consumer, 10 scene, 11 detail, 15 source desktop and 15 independent executable checks passed. Final screenshot/material polish checked directly. CI now includes detail browser suite. Quasi-static boundaries and historical 1.3 installation evidence preserved.

Next: submit review branch, confirm remote CI. No public release replacement performed. Future detail passes can expand cage pocket geometry, measured friction curves and validation datasets; these are not represented as completed engineering validation.
