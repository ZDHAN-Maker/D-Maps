import hashlib
import json
import struct
from pathlib import Path

import pytest
from dmaps_pipeline.build_dataset import build, decode_deltas, encode_deltas
from dmaps_pipeline.binfmt import read_header

FIXTURE = Path(__file__).resolve().parents[2] / "data/fixtures/monaco/monaco.osm.pbf"
pytestmark = pytest.mark.skipif(not FIXTURE.exists(), reason="Monaco fixture not present")


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("ds")
    manifest = build(FIXTURE, out, "monaco", "Monaco test")
    return out, manifest


def test_delta_roundtrip():
    pts = [(43.7311, 7.4210), (43.7312, 7.4199), (43.7300, 7.4250)]
    back = decode_deltas(encode_deltas(pts))
    for (a, b), (c, d) in zip(pts, back):
        assert abs(a - c) < 1e-6 and abs(b - d) < 1e-6


def test_manifest_matches_files(built):
    out, m = built
    for f in m["files"]:
        data = (out / f["name"]).read_bytes()
        assert len(data) == f["bytes"]
        assert hashlib.sha256(data).hexdigest() == f["sha256"]
    assert m["license"] == "ODbL-1.0"
    assert any("turn-restriction" in s for s in m["limitations"])


def test_graph_header_and_csr_invariants(built):
    out, m = built
    h = read_header(out / "graph.bin")
    assert h["nodes"] == m["stats"]["nodes"] and h["edges"] == m["stats"]["edges"]
    raw = (out / "graph.bin").read_bytes()
    n, e = h["nodes"], h["edges"]
    off = 32 + 8 * n  # skip lat+lon
    first = struct.unpack_from(f"<{n + 1}I", raw, off)
    off += 4 * (n + 1)
    target = struct.unpack_from(f"<{e}I", raw, off)
    assert first[0] == 0 and first[-1] == e
    assert all(a <= b for a, b in zip(first, first[1:]))
    assert max(target) < n
    # edges are sorted by source then target (determinism contract)
    for i in range(0, n, 97):
        seg = target[first[i]:first[i + 1]]
        assert list(seg) == sorted(seg)


def test_places_cover_required_categories(built):
    out, m = built
    cats = m["stats"]["placesByCategory"]
    for c in ("hospital", "pharmacy", "fuel", "restaurant", "hotel", "atm", "attraction", "street"):
        assert cats.get(c, 0) > 0, c
    places = json.loads((out / "places.json").read_text("utf-8"))
    assert [p["i"] for p in places] == list(range(len(places)))


def test_build_is_deterministic(built, tmp_path):
    out, m = built
    m2 = build(FIXTURE, tmp_path, "monaco", "Monaco test")
    assert m2["dataVersion"] == m["dataVersion"]


def test_hospitals_carry_emergency_tag(built):
    out, _ = built
    places = json.loads((out / "places.json").read_text("utf-8"))
    hospitals = [p for p in places if p["c"] == "hospital"]
    assert hospitals and all(p.get("em") in ("yes", "no", None) for p in hospitals)
    assert any(p.get("em") == "no" for p in hospitals)   # fixture contains emergency=no hospitals
    assert any(p.get("em") == "yes" for p in hospitals)
