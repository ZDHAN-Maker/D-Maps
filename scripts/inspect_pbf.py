"""Quick tag-vocabulary inspection of an OSM PBF (engineering aid, not part of the pipeline)."""
import sys, collections
import osmium

class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.hw = collections.Counter(); self.oneway = collections.Counter()
        self.poi = collections.Counter(); self.names = 0; self.junction = collections.Counter()
        self.access = collections.Counter(); self.maxspeed = collections.Counter()
        self.addr = 0; self.restr = 0; self.nodes = 0; self.ways = 0; self.rels = 0
    def node(self, n):
        self.nodes += 1
        t = n.tags
        for k in ("amenity", "tourism", "shop", "healthcare", "leisure", "historic", "place"):
            if k in t and "name" in t:
                self.poi[f"{k}={t[k]}"] += 1
        if "addr:housenumber" in t: self.addr += 1
    def way(self, w):
        self.ways += 1
        t = w.tags
        if "highway" in t:
            self.hw[t["highway"]] += 1
            if "oneway" in t: self.oneway[t["oneway"]] += 1
            if "junction" in t: self.junction[t["junction"]] += 1
            for k in ("access", "motor_vehicle", "vehicle"):
                if k in t: self.access[f"{k}={t[k]}"] += 1
            if "maxspeed" in t: self.maxspeed[t["maxspeed"]] += 1
            if "name" in t: self.names += 1
    def relation(self, r):
        self.rels += 1
        if r.tags.get("type") == "restriction": self.restr += 1

h = H(); h.apply_file(sys.argv[1])
print("nodes", h.nodes, "ways", h.ways, "relations", h.rels, "turn-restrictions", h.restr, "addr nodes", h.addr)
print("highway:", dict(h.hw.most_common())); print("oneway:", dict(h.oneway)); print("junction:", dict(h.junction))
print("access:", dict(h.access)); print("maxspeed:", dict(h.maxspeed.most_common(8)))
print("named highways:", h.names); print("poi:", dict(h.poi.most_common(25)))
