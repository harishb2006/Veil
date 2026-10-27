from backend.risk import entity_risk, overall_risk


def test_entity_risk_high_types():
    for entity_type in ["API_KEY", "PASSWORD", "JWT", "CARD", "GOV_ID", "MEDICAL", "FINANCIAL"]:
        assert entity_risk(entity_type) == "HIGH"


def test_entity_risk_medium_types():
    for entity_type in ["PERSON", "EMAIL", "PHONE", "ADDRESS", "HR", "INTERNAL_URL", "IP_ADDRESS", "ORG", "PROJECT"]:
        assert entity_risk(entity_type) == "MEDIUM"


def test_entity_risk_low_types_and_unknown():
    assert entity_risk("LOCATION") == "LOW"
    assert entity_risk("OTHER") == "LOW"
    assert entity_risk("UNKNOWN") == "LOW"


def test_overall_risk_rules():
    assert overall_risk([]) == "NONE"
    assert overall_risk(["LOCATION"]) == "LOW"
    assert overall_risk(["EMAIL"]) == "MEDIUM"
    assert overall_risk(["EMAIL", "PHONE", "PERSON"]) == "HIGH"
    assert overall_risk(["EMAIL", "PHONE"]) == "MEDIUM"
    assert overall_risk(["EMAIL", "API_KEY"]) == "HIGH"
    assert overall_risk(["LOCATION", "OTHER"]) == "LOW"
