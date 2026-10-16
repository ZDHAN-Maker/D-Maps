"""Print OSM tags of features whose name matches a substring (debug aid)."""
import sys
import osmium

needle = sys.argv[2].lower()

class H(osmium.SimpleHandler):
    def _show(self, kind, o):
        n = o.tags.get("name", "")
        if needle in n.lower():
            print(kind, o.id, dict((t.k, t.v) for t in o.tags))
    def node(self, n): self._show("node", n)
    def way(self, w): self._show("way", w)

H().apply_file(sys.argv[1])
