import pytest
from dmaps_pipeline import profile as P


@pytest.mark.parametrize("value,expected", [
    ("50", 50), ("50 km/h", 50), ("30 mph", pytest.approx(48.28, abs=0.01)),
    ("walk", None), ("none", None), ("", None), (None, None), ("0", None), ("999", None),
])
def test_parse_maxspeed(value, expected):
    assert P.parse_maxspeed(value) == expected


def test_road_class_filters_non_drivable_and_service_noise():
    assert P.road_class({"highway": "residential"}) == "residential"
    assert P.road_class({"highway": "primary_link"}) == "primary"
    assert P.road_class({"highway": "footway"}) is None
    assert P.road_class({"highway": "steps"}) is None
    assert P.road_class({"highway": "service", "service": "parking_aisle"}) is None
    assert P.road_class({"highway": "service", "service": "alley"}) == "service"
    assert P.road_class({"highway": "pedestrian", "area": "yes"}) is None
    assert P.road_class({"highway": "residential", "area": "yes"}) is None


def test_access_rules():
    assert P.access({}) == "yes"
    assert P.access({"access": "private"}) == "no"
    assert P.access({"access": "no", "motor_vehicle": "yes"}) == "yes"  # specific beats general
    assert P.access({"motor_vehicle": "destination"}) == "destination"
    assert P.access({"vehicle": "no"}) == "no"


def test_oneway_rules():
    assert P.oneway({"oneway": "yes"}, False, False) == 1
    assert P.oneway({"oneway": "-1"}, False, False) == -1
    assert P.oneway({"oneway": "no"}, True, False) == 0
    assert P.oneway({}, False, True) == 1          # roundabout implies forward
    assert P.oneway({}, True, False) == 1          # motorway implies forward
    assert P.oneway({}, False, False) == 0


def test_speed_defaults_links_and_bounds():
    assert P.speed_kmh({}, "residential", False) == 25
    assert P.speed_kmh({}, "primary", True) == 35   # 50 * 0.7
    assert P.speed_kmh({"maxspeed": "70"}, "primary", False) == 70
    assert P.speed_kmh({"maxspeed": "300"}, "primary", False) == 50  # implausible -> default


def test_poi_categories_cover_required_set():
    assert P.poi_category({"amenity": "hospital"}) == "hospital"
    assert P.poi_category({"amenity": "pharmacy"}) == "pharmacy"
    # doctors / clinics must NOT be reported as hospitals
    assert P.poi_category({"amenity": "clinic"}) == "clinic"
    assert P.poi_category({"amenity": "doctors"}) == "clinic"
    assert P.poi_category({"healthcare": "hospital"}) == "hospital"
    assert P.poi_category({"amenity": "fuel"}) == "fuel"
    assert P.poi_category({"amenity": "restaurant"}) == "restaurant"
    assert P.poi_category({"tourism": "hotel"}) == "hotel"
    assert P.poi_category({"amenity": "atm"}) == "atm"
    assert P.poi_category({"tourism": "attraction"}) == "attraction"
    assert P.poi_category({"foo": "bar"}) is None
