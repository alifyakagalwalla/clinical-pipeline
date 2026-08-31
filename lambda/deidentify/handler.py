import boto3

comprehend_medical = boto3.client("comprehendmedical")

def handler(event, context):
    text = event.get("document_text", "")
    
    if not text:
        event["deidentified_text"] = ""
        return event

    result = comprehend_medical.detect_phi(Text=text)
    redacted = text
    # Walk entities in reverse so character offsets don't shift as you redact.
    for entity in sorted(result["Entities"], key=lambda e: e["BeginOffset"], reverse=True):
        category = entity["Category"]
        begin, end = entity["BeginOffset"], entity["EndOffset"]
        redacted = redacted[:begin] + f"[{category}]" + redacted[end:]

    event["deidentified_text"] = redacted
    event["phi_entities_found"] = len(result["Entities"])
    event["stage_completed"] = "deidentify"
    return event