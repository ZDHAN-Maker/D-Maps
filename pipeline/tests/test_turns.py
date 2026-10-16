import struct
from pathlib import Path

import pytest
from dmaps_pipeline import profile as P
from dmaps_pipeline.binfmt import read_turns, write_turns
from dmaps_pipeline.build_dataset import build, build_graph
from dmaps_pipeline.turns import Restriction, resolve_turns


# ---- tag rules -------------------------------------------------------------------------

@pytest.mark.parametrize("tags,expected", [
    ({"restriction": "no_left_turn"}, ("no", "left_turn")),
    ({"restriction": "only_straight_on"}, ("only", "straight_on")),
    ({"restriction:motorcar": "no_u_turn"}, ("no", "u_turn")),
    ({"restriction:hgv": "no_left_turn"}, None),          # trucks only: not our profile
    ({"restriction:conditional": "no_left_turn @ (Mo-Fr)"}, None),
    ({"restriction": "nonsense"}, None),
    ({}, None),
])
def test_restriction_kind(tags, expected):
    assert P.restriction_kind(tags) == expected


@pytest.mark.parametrize("tags,applies", [
    ({}, True),
    ({"except": "psv"}, True),
    ({"except": "bicycle;psv"}, True),
    ({"except": "motorcar"}, False),
    ({"except": "psv; motor_vehicle"}, False),
    ({"except": "vehicle"}, False),
])
def test_restriction_exceptions(tags, applies):
    assert P.restriction_applies_to_cars(tags) is applies


# ---- resolver on a hand-built junction ---------------------------------------------------
#
#   A(1) --way10--> V(2) --way20--> B(3)
#                    |
#                  way30
#                    |
#                   C(4)

def way(wid, refs, direction=0):
    return {"id": wid, "nodes": [(r, 0.0, 0.0) for r in refs], "cls": 6, "speed": 30, "flags": 0,
            "dir": direction, "name": f"w{wid}", "ref": None}


def graph(ways):
    # give nodes distinct coordinates so haversine lengths are positive
    for w in ways:
        w["nodes"] = [(r, r * 0.001, r * 0.001) for r, _, _ in w["nodes"]]
    return build_graph(ways)


def edge_of(g, src_ref, dst_ref):
    s, d = g["index"][src_ref], g["index"][dst_ref]
    return next(e for e in range(g["first"][s], g["first"][s + 1]) if g["target"][e] == d)


def resolve(ways, restrictions):
    g = graph(ways)
    return g, resolve_turns(ways, restrictions, g["index"], g["first"], g["target"], g["way"])


def test_no_turn_forbids_exactly_one_pair():
    ways = [way(10, [1, 2]), way(20, [2, 3]), way(30, [2, 4])]
    g, (pairs, stats) = resolve(ways, [Restriction("no", "left_turn", 10, 2, 20)])
    assert pairs == [(edge_of(g, 1, 2), edge_of(g, 2, 3))]
    assert stats["relationsApplied"] == 1 and stats["skipped"] == {}


def test_only_turn_forbids_every_other_exit_including_u_turn():
    ways = [way(10, [1, 2]), way(20, [2, 3]), way(30, [2, 4])]
    g, (pairs, _) = resolve(ways, [Restriction("only", "straight_on", 10, 2, 20)])
    arrive = edge_of(g, 1, 2)
    assert pairs == sorted([(arrive, edge_of(g, 2, 4)), (arrive, edge_of(g, 2, 1))])


def test_way_direction_does_not_matter_for_finding_via_end():
    # from-way is stored *away* from the junction (via is its first node), still resolvable
    ways = [way(10, [2, 1]), way(20, [2, 3])]
    g, (pairs, _) = resolve(ways, [Restriction("no", "u_turn", 10, 2, 20)])
    assert pairs == [(edge_of(g, 1, 2), edge_of(g, 2, 3))]


def test_unsupported_cases_are_skipped_not_guessed():
    ways = [way(10, [1, 2, 5]), way(20, [2, 3]), way(30, [2, 4]), way(40, [6, 7], direction=1)]
    cases = {
        "via_way": Restriction("no", "x", 10, None, 20, via_is_way=True),
        "via_not_at_way_end": Restriction("no", "x", 10, 2, 20),                 # via is mid-way on way 10
        "not_routable_or_missing_member": Restriction("no", "x", 999, 2, 20),    # from-way is not in the graph
    }
    for reason, r in cases.items():
        _, (pairs, stats) = resolve(ways, [r])
        assert pairs == [] and stats["skipped"] == {reason: 1}, reason


def test_restriction_drawn_against_a_one_way_is_skipped():
    # way 20 is one-way *into* V, so there is no edge V->B to forbid
    ways = [way(10, [1, 2]), way(20, [3, 2], direction=1)]
    _, (pairs, stats) = resolve(ways, [Restriction("no", "left_turn", 10, 2, 20)])
    assert pairs == [] and stats["skipped"] == {"edge_not_in_graph": 1}


def test_closed_loop_way_is_ambiguous_and_skipped():
    ways = [way(10, [1, 2]), way(20, [2, 3, 4, 2])]
    _, (pairs, stats) = resolve(ways, [Restriction("no", "x", 10, 2, 20)])
    assert pairs == [] and stats["skipped"] == {"closed_or_degenerate_way": 1}


# ---- turns.bin ---------------------------------------------------------------------------

def test_turns_file_roundtrip_and_validation(tmp_path):
    p = tmp_path / "turns.bin"
    write_turns(p, [(5, 9), (1, 2), (1, 2), (3, 4)])
    assert read_turns(p) == [(1, 2), (3, 4), (5, 9)]          # sorted, de-duplicated
    assert p.stat().st_size == 16 + 8 * 3
    raw = bytearray(p.read_bytes())
    raw[0:4] = b"XXXX"
    p.write_bytes(bytes(raw))
    with pytest.raises(ValueError):
        read_turns(p)
    write_turns(p, [])
    assert read_turns(p) == []
    p.write_bytes(p.read_bytes() + b"\0")
    with pytest.raises(ValueError):
        read_turns(p)


# ---- real data ---------------------------------------------------------------------------

FIXTURE = Path(__file__).resolve().parents[2] / "data/fixtures/monaco/monaco.osm.pbf"


@pytest.mark.skipif(not FIXTURE.exists(), reason="Monaco fixture not present")
def test_monaco_turn_restrictions_are_extracted(tmp_path):
    m = build(FIXTURE, tmp_path, "monaco", "Monaco test")
    stats = m["stats"]["turnRestrictions"]
    assert m["stats"]["restrictionRelationsSeen"] == 27
    assert stats["relationsApplied"] > 0 and stats["pairs"] >= stats["relationsApplied"]
    pairs = read_turns(tmp_path / "turns.bin")
    assert len(pairs) == stats["pairs"] and pairs == sorted(set(pairs))
    names = [f["name"] for f in m["files"]]
    assert names[-1] == "turns.bin"            # appended last: keeps the order of the original four files
    edges = m["stats"]["edges"]
    assert all(a < edges and b < edges for a, b in pairs)
    # the format is documented as little-endian u32 pairs after a 16-byte header
    raw = (tmp_path / "turns.bin").read_bytes()
    assert struct.unpack_from("<4sIII", raw, 0) == (b"DMTN", 1, len(pairs), 0)
