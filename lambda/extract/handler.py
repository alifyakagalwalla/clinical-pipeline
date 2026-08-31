import json
import boto3

bedrock = boto3.client("bedrock-runtime")

EXTRACTION_PROMPT = """You are extracting structured clinical information from a de-identified note.
Given the text below, return JSON with these fields: chief_complaint, medications_mentioned (list),
diagnoses_mentioned (list), and a one-sentence summary. If a field isn't present, use null or [].

Text:
{text}

Respond with ONLY the JSON object, no other text."""


def handler(event, context):

    text = event.get("deidentified_text") or event.get("document_text", "")
    prompt = EXTRACTION_PROMPT.format(text=text)

    response = bedrock.invoke_model(
        modelId="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        }),
    )
    body = json.loads(response["body"].read())
    extracted_text = body["content"][0]["text"].strip()
    if extracted_text.startswith("```"):
        # Strip markdown code fences (e.g. ```json ... ```) before parsing.
        extracted_text = extracted_text.strip("`")
        if extracted_text.startswith("json"):
            extracted_text = extracted_text[4:].strip()

    try:
        structured = json.loads(extracted_text)
    except json.JSONDecodeError:
        structured = {"error": "model did not return valid JSON", "raw": extracted_text}

    event["extracted"] = structured
    event["stage_completed"] = "extract"
    return event