import json
from pathlib import Path

import pytest

from dmaps_pipeline.catalog import CatalogError, build_catalog

FILES = [{"name": "graph.bin", "bytes": 10, "sha256": "a" * 64}, {"name": "places.json", "bytes": 5, "sha256": "b" * 64}]


def _manifest(d: Path, ds_id: str, dir_name: str | None = None) -> None:
    p = d / (dir_name or ds_id)
    p.mkdir(parents=True)
    (p / "manifest.json").write_text(json.dumps({
        "id": ds_id, "name": ds_id.title(), "dataVersion": "0" * 12, "bbox": [0, 0, 1, 1],
        "license": "ODbL-1.0", "files": FILES,
    }))


def _regions(tmp: Path, cfg: dict) -> Path:
    f = tmp / "regions.json"
    f.write_text(json.dumps(cfg))
    return f


GROUPS = [{"id": "indonesia", "parent": None, "name": "Indonesia"}, {"id": "test", "parent": None, "name": "Test", "testFixture": True}]


def test_lists_groups_and_datasets_and_keeps_empty_groups(tmp_path):
    data = tmp_path / "data"
    _manifest(data, "monaco")
    cat = build_catalog(data, _regions(tmp_path, {"groups": GROUPS, "datasets": {"monaco": {"parent": "test", "testFixture": True}}}))
    by_id = {r["id"]: r for r in cat["regions"]}
    assert by_id["indonesia"]["kind"] == "group"          # empty group is still listed: the UI says "nothing yet"
    m = by_id["monaco"]
    assert (m["kind"], m["parent"], m["bytes"], m["testFixture"]) == ("dataset", "test", 15, True)
    assert [f["name"] for f in m["files"]] == ["graph.bin", "places.json"]


def test_is_deterministic(tmp_path):
    data = tmp_path / "data"
    _manifest(data, "b")
    _manifest(data, "a")
    cfg = _regions(tmp_path, {"groups": GROUPS, "datasets": {"a": {"parent": "test"}, "b": {"parent": "test"}}})
    assert build_catalog(data, cfg) == build_catalog(data, cfg)
    ids = [r["id"] for r in build_catalog(data, cfg)["regions"] if r["kind"] == "dataset"]
    assert ids == ["a", "b"]


@pytest.mark.parametrize("cfg,needle", [
    ({"groups": GROUPS, "datasets": {}}, "not attached"),
    ({"groups": GROUPS, "datasets": {"monaco": {"parent": "nope"}}}, "unknown parent"),
    ({"groups": GROUPS, "datasets": {"monaco": {"parent": "test"}, "ghost": {"parent": "test"}}}, "not built"),
    ({"groups": GROUPS + [{"id": "test", "parent": None, "name": "dup"}], "datasets": {}}, "duplicate group"),
    ({"groups": [{"id": "x", "parent": "missing", "name": "x"}], "datasets": {}}, "unknown parent"),
])
def test_rejects_inconsistent_config(tmp_path, cfg, needle):
    data = tmp_path / "data"
    _manifest(data, "monaco")
    with pytest.raises(CatalogError, match=needle):
        build_catalog(data, _regions(tmp_path, cfg))


def test_directory_must_match_manifest_id(tmp_path):
    data = tmp_path / "data"
    _manifest(data, "monaco", dir_name="other")
    with pytest.raises(CatalogError, match="directory name"):
        build_catalog(data, _regions(tmp_path, {"groups": GROUPS, "datasets": {"monaco": {"parent": "test"}}}))
