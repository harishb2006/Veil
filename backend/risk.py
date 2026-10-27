HIGH_TYPES = {"API_KEY", "PASSWORD", "JWT", "CARD", "GOV_ID", "MEDICAL", "FINANCIAL"}
MEDIUM_TYPES = {"PERSON", "EMAIL", "PHONE", "ADDRESS", "HR", "INTERNAL_URL", "IP_ADDRESS", "ORG", "PROJECT"}


def entity_risk(entity_type: str) -> str:
    if entity_type in HIGH_TYPES:
        return "HIGH"
    if entity_type in MEDIUM_TYPES:
        return "MEDIUM"
    return "LOW"


def overall_risk(entity_types: list[str]) -> str:
    if not entity_types:
        return "NONE"
    risks = [entity_risk(entity_type) for entity_type in entity_types]
    if "HIGH" in risks:
        return "HIGH"
    if risks.count("MEDIUM") >= 3:
        return "HIGH"
    if "MEDIUM" in risks:
        return "MEDIUM"
    return "LOW"
