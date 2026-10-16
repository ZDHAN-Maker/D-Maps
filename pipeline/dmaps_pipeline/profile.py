"""Pure tag-interpretation rules for the D'Maps car routing profile.

Everything here is a plain function over a tag dict so it can be unit tested without
an OSM file.  The speed table is a *heuristic* default (not measured Indonesian traffic
data); ETAs derived from it are approximate and the UI must say so.
"""
from __future__ import annotations

import re

# Road classes stored in graph.bin (uint8). Order is part of the binary format.
CLASSES = [
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "unclassified", "residential", "living_street", "service",
]
CLASS_ID = {name: i for i, name in enumerate(CLASSES)}

# Edge flag bits (uint8) -- part of the binary format.
FLAG_ROUNDABOUT = 1 << 0
FLAG_ONEWAY = 1 << 1      # edge belongs to a one-way way (informational)
FLAG_LINK = 1 << 2        # *_link slip road / ramp
FLAG_DESTINATION = 1 << 3  # access=destination style restriction (engine penalises)

DRIVABLE = {
    "motorway": "motorway", "motorway_link": "motorway",
    "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "unclassified": "unclassified", "residential": "residential",
    "living_street": "living_street", "service": "service", "road": "unclassified",
}

# km/h defaults by class.  Heuristic; see module docstring.
DEFAULT_SPEED = {
    "motorway": 80, "trunk": 60, "primary": 50, "secondary": 40, "tertiary": 35,
    "unclassified": 30, "residential": 25, "living_street": 10, "service": 15,
}
LINK_SPEED_FACTOR = 0.7
MAX_SPEED_KMH = 120

# Service roads that must not be used for through-routing.
EXCLUDED_SERVICE = {"parking_aisle", "driveway", "drive-through", "emergency_access"}

_NO = {"no", "private", "customers", "delivery", "agricultural", "forestry"}
_YES = {"yes", "permissive", "designated"}


def road_class(tags) -> str | None:
    """Return the drivable class for a way, or None if it is not routable by car."""
    hw = tags.get("highway")
    cls = DRIVABLE.get(hw)
    if cls is None:
        return None
    if tags.get("area") == "yes":
        return None
    if hw == "service" and tags.get("service") in EXCLUDED_SERVICE:
        return None
    return cls


def access(tags) -> str:
    """Return 'yes', 'destination' or 'no' for general motor-vehicle access."""
    for key in ("motor_vehicle", "motorcar", "vehicle", "access"):
        v = tags.get(key)
        if v is None:
            continue
        if v in _YES:
            return "yes"
        if v == "destination":
            return "destination"
        if v in _NO:
            return "no"
    return "yes"


def oneway(tags, cls_is_motorway_like: bool, roundabout: bool) -> int:
    """+1 forward only, -1 backward only, 0 both directions."""
    v = tags.get("oneway")
    if v in ("yes", "true", "1"):
        return 1
    if v in ("-1", "reverse"):
        return -1
    if v in ("no", "false", "0"):
        return 0
    if roundabout or cls_is_motorway_like:
        return 1
    return 0


_SPEED_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph)?\s*$")


def parse_maxspeed(value: str | None) -> float | None:
    if not value:
        return None
    m = _SPEED_RE.match(value)
    if not m:
        return None
    n = float(m.group(1))
    if m.group(2) == "mph":
        n *= 1.609344
    if n <= 0 or n > 200:
        return None
    return n


def speed_kmh(tags, cls: str, is_link: bool) -> int:
    explicit = parse_maxspeed(tags.get("maxspeed"))
    if explicit is not None:
        v = explicit
    else:
        v = DEFAULT_SPEED[cls] * (LINK_SPEED_FACTOR if is_link else 1.0)
    return max(5, min(MAX_SPEED_KMH, int(round(v))))


# ---- POI categorisation -------------------------------------------------------------

def poi_category(tags) -> str | None:
    amenity, tourism, shop = tags.get("amenity"), tags.get("tourism"), tags.get("shop")
    # Only real hospitals are "hospital": a user searching for one in an emergency must not
    # be shown a doctor's office. Clinics / doctors / dentists get their own category.
    if amenity == "hospital" or tags.get("healthcare") == "hospital":
        return "hospital"
    if amenity in ("clinic", "doctors", "dentist") or tags.get("healthcare") in ("clinic", "doctor", "dentist"):
        return "clinic"
    if amenity == "pharmacy":
        return "pharmacy"
    if amenity == "fuel":
        return "fuel"
    if amenity in ("restaurant", "cafe", "fast_food", "food_court", "pub", "bar"):
        return "restaurant"
    if tourism in ("hotel", "hostel", "guest_house", "motel", "apartment"):
        return "hotel"
    if amenity == "atm":
        return "atm"
    if tourism in ("attraction", "museum", "viewpoint", "gallery", "zoo", "theme_park") \
            or tags.get("historic"):
        return "attraction"
    if amenity in ("bank", "post_office", "police", "school", "university", "place_of_worship",
                   "library", "cinema", "theatre", "townhall", "marketplace", "bus_station"):
        return "service"
    if shop:
        return "shop"
    if tags.get("railway") == "station" or tags.get("aeroway") == "aerodrome":
        return "transport"
    return None


PLACE_AREAS = {"city", "town", "village", "suburb", "neighbourhood", "quarter", "hamlet",
               "island", "locality", "municipality", "district"}


def display_name(tags) -> str | None:
    return tags.get("name") or tags.get("brand") or tags.get("operator") or None


# ---- turn restrictions ----------------------------------------------------------------

# Tag keys that carry a restriction meant for cars. `restriction:hgv`, `:bus`, `:conditional` ... are ignored.
RESTRICTION_KEYS = ("restriction", "restriction:motorcar", "restriction:motor_vehicle")
# `except=...` values that exempt cars from a restriction.
CAR_EXCEPTIONS = {"motorcar", "motor_vehicle", "vehicle"}


def restriction_kind(tags) -> tuple[str, str] | None:
    """('no' | 'only', detail) for a simple car-relevant turn restriction, else None.

    `no_left_turn` -> ('no', 'left_turn'); `only_straight_on` -> ('only', 'straight_on').
    """
    for key in RESTRICTION_KEYS:
        v = tags.get(key)
        if v:
            if v.startswith("no_"):
                return ("no", v[3:])
            if v.startswith("only_"):
                return ("only", v[5:])
            return None
    return None


def restriction_applies_to_cars(tags) -> bool:
    exempt = {x.strip() for x in (tags.get("except") or "").split(";") if x.strip()}
    return not (exempt & CAR_EXCEPTIONS)
