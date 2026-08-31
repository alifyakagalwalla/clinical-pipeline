REQUIRED_FIELDS = {"chief_complaint", "medications_mentioned", "diagnoses_mentioned"}

def handler(event, context):
    structured = event.get("extracted", {})
    missing = REQUIRED_FIELDS - structured.keys()
    event["schema_valid"] = len(missing) == 0
    event["missing_fields"] = list(missing)
    event["stage_completed"] = "validate"
    return event