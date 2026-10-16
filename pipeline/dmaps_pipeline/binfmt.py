"""graph.bin writer / reader (format version 1).  All integers little-endian.

Header (32 bytes): magic 'DMGR', u32 version, u32 N (nodes), u32 E (edges), 16 reserved bytes.
Sections, each padded to a 4-byte boundary, in this order:
    lat        int32[N]   degrees * 1e7
    lon        int32[N]   degrees * 1e7
    firstEdge  uint32[N+1] CSR offsets (edges of node i are firstEdge[i] .. firstEdge[i+1]-1)
    target     uint32[E]  target node index
    lenDm      uint32[E]  edge length in decimetres
    way        uint32[E]  index into ways.json
    speed      uint8[E]   km/h
    cls        uint8[E]   road class id (see profile.CLASSES)
    flags      uint8[E]   see profile.FLAG_*
The TypeScript loader (src/routing/graph.ts) mirrors this layout; keep both in sync.
"""
from __future__ import annotations

import struct
from array import array

MAGIC = b"DMGR"
VERSION = 1
HEADER = 32


def _pad4(n: int) -> int:
    return (4 - n % 4) % 4


def write_graph(path, lat1e7, lon1e7, first_edge, target, len_dm, way, speed, cls, flags) -> None:
    n = len(lat1e7)
    e = len(target)
    assert len(first_edge) == n + 1 and first_edge[-1] == e
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<III", VERSION, n, e) + b"\0" * 16)
        for arr, code in ((lat1e7, "i"), (lon1e7, "i"), (first_edge, "I"), (target, "I"),
                          (len_dm, "I"), (way, "I")):
            a = array(code, arr)
            assert a.itemsize == 4
            f.write(a.tobytes())  # host is little-endian on all supported build machines
        for arr in (speed, cls, flags):
            b = bytes(arr)
            f.write(b + b"\0" * _pad4(len(b)))


def read_header(path):
    with open(path, "rb") as f:
        head = f.read(HEADER)
    if head[:4] != MAGIC:
        raise ValueError("not a D'Maps graph file")
    version, n, e = struct.unpack("<III", head[4:16])
    return {"version": version, "nodes": n, "edges": e}


# ---- turns.bin (optional; listed in manifest.files only when present) ---------------------
#
# Header (16 bytes): magic 'DMTN', u32 version (1), u32 count, u32 reserved (0).
# Then `count` pairs of u32 (fromEdge, toEdge), sorted by (fromEdge, toEdge), little-endian.
# Edge numbers index graph.bin's edge arrays.  A pair means: arriving over fromEdge you may NOT leave
# over toEdge (an `only_*` restriction is stored as the forbidden complement).
TURNS_MAGIC = b"DMTN"
TURNS_VERSION = 1
TURNS_HEADER = 16


def write_turns(path, pairs) -> None:
    pairs = sorted(set(pairs))
    flat = array("I")
    for a, b in pairs:
        flat.extend((a, b))
    assert flat.itemsize == 4
    with open(path, "wb") as f:
        f.write(TURNS_MAGIC + struct.pack("<III", TURNS_VERSION, len(pairs), 0))
        f.write(flat.tobytes())  # host is little-endian on all supported build machines


def read_turns(path) -> list[tuple[int, int]]:
    raw = open(path, "rb").read()
    if raw[:4] != TURNS_MAGIC:
        raise ValueError("not a D'Maps turns file")
    version, count, _ = struct.unpack("<III", raw[4:16])
    if version != TURNS_VERSION or len(raw) != TURNS_HEADER + 8 * count:
        raise ValueError("corrupt or unsupported turns file")
    vals = struct.unpack(f"<{2 * count}I", raw[TURNS_HEADER:])
    return list(zip(vals[0::2], vals[1::2]))
