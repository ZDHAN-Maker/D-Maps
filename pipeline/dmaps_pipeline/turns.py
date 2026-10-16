"""Resolve OSM turn-restriction relations into forbidden (fromEdge, toEdge) pairs of the routing graph.

Pure functions over plain data, so they are unit tested without an OSM file.

Scope: *simple* restrictions only -- relation members `from` (way), `via` (one node) and `to` (way),
where the via node is an end node of both ways (the OSM mapping rule: ways are split at the via node).
Everything else is counted in `skipped` and NOT applied; the dataset manifest says so:
via-way restrictions, conditional restrictions, via nodes in the middle of a way, missing members,
ways that are not routable by car, and edges that do not exist (e.g. against a one-way).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Restriction:
    kind: str                 # 'no' | 'only'
    detail: str               # 'left_turn', 'straight_on', ...
    from_way: int | None
    via_node: int | None
    to_way: int | None
    via_is_way: bool = False


def _dedupe(refs):
    out = []
    for r in refs:
        if not out or out[-1] != r:
            out.append(r)
    return out


def resolve_turns(route_ways, restrictions, index, first, target, way):
    """Return (sorted list of forbidden (fromEdge, toEdge) pairs, stats dict).

    route_ways : list of dicts with 'id' (OSM way id) and 'nodes' [(ref, lat, lon), ...]; the position in
                 the list is the way index stored in graph.bin (`way` array)
    index      : OSM node id -> compact node index
    first/target/way : CSR arrays of graph.bin (outgoing edges of u are first[u] .. first[u+1]-1)
    """
    pos = {w["id"]: i for i, w in enumerate(route_ways)}
    skipped: Counter = Counter()
    pairs: set[tuple[int, int]] = set()
    applied = 0

    def edge(src, dst, widx):
        for e in range(first[src], first[src + 1]):
            if target[e] == dst and way[e] == widx:
                return e
        return None

    for r in restrictions:
        if r.via_is_way:
            skipped["via_way"] += 1
            continue
        if r.from_way not in pos or r.to_way not in pos or r.via_node not in index:
            skipped["not_routable_or_missing_member"] += 1
            continue
        fi, ti = pos[r.from_way], pos[r.to_way]
        f_refs = _dedupe([n[0] for n in route_ways[fi]["nodes"]])
        t_refs = _dedupe([n[0] for n in route_ways[ti]["nodes"]])
        via = r.via_node
        if len(f_refs) < 2 or len(t_refs) < 2 or f_refs[0] == f_refs[-1] or t_refs[0] == t_refs[-1]:
            skipped["closed_or_degenerate_way"] += 1   # a loop way touches via at both ends: ambiguous
            continue
        if f_refs[-1] == via:
            prev = f_refs[-2]
        elif f_refs[0] == via:
            prev = f_refs[1]
        else:
            skipped["via_not_at_way_end"] += 1
            continue
        if t_refs[0] == via:
            nxt = t_refs[1]
        elif t_refs[-1] == via:
            nxt = t_refs[-2]
        else:
            skipped["via_not_at_way_end"] += 1
            continue
        if prev not in index or nxt not in index:
            skipped["not_routable_or_missing_member"] += 1
            continue
        arrive = edge(index[prev], index[via], fi)
        depart = edge(index[via], index[nxt], ti)
        if arrive is None or depart is None:
            skipped["edge_not_in_graph"] += 1          # e.g. restriction drawn against a one-way
            continue
        v = index[via]
        if r.kind == "no":
            pairs.add((arrive, depart))
        else:  # only_*: forbid every other way out of the via node
            others = [e for e in range(first[v], first[v + 1]) if e != depart]
            for e in others:
                pairs.add((arrive, e))
        applied += 1

    out = sorted(pairs)
    for a, b in out:  # invariant: the two edges really meet at one node
        assert target[a] == _source_of(first, b), (a, b)
    return out, {"relationsApplied": applied, "pairs": len(out), "skipped": dict(sorted(skipped.items()))}


def _source_of(first, e):
    """Source node of edge e by binary search over the CSR offsets."""
    lo, hi = 0, len(first) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if first[mid] <= e:
            lo = mid
        else:
            hi = mid - 1
    return lo
