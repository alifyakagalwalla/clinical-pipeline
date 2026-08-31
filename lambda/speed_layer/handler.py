import json
import boto3

s3 = boto3.client("s3")

def handler(event, context):
    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]

        head = s3.head_object(Bucket=bucket, Key=key)
        size = head["ContentLength"]

        # Cheap, fast checks only — no OCR, no model calls here.
        if size == 0:
            print(f"REJECTED empty object: {key}")
            continue
        if size > 50_000_000:
            print(f"FLAGGED oversized object for manual review: {key}")
            continue

        print(f"ACCEPTED {key} ({size} bytes) — routing to batch layer")
    return {"statusCode": 200}