import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export class ClinicalPipelineStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly curatedBucket: s3.Bucket;
  public readonly dataKey: kms.Key;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.dataKey = new kms.Key(this, 'ClinicalDataKey', {
      enableKeyRotation: true,
      description: 'CMK for all clinical pipeline data at rest',
    });

    this.rawBucket = new s3.Bucket(this, 'RawZone', {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // sandbox only
      autoDeleteObjects: true, // sandbox only, so `cdk destroy` actually cleans up
    });

    this.processedBucket = new s3.Bucket(this, 'ProcessedZone', {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.curatedBucket = new s3.Bucket(this, 'CuratedZone', {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const speedLayerFn = new lambda.Function(this, 'SpeedLayerFn', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('lambda/speed_layer'),
  timeout: cdk.Duration.seconds(10),
  memorySize: 256,
});
this.rawBucket.grantRead(speedLayerFn);

this.rawBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(speedLayerFn),
  { prefix: 'incoming/' }
);

this.rawBucket.enableEventBridgeNotification(); // needed later, for Module 3
  
//Adding step functions for de-identify, validate and extract


const deidFn = new lambda.Function(this, 'DeidentifyFn', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('lambda/deidentify'),
  timeout: cdk.Duration.seconds(30),
});

deidFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['comprehendmedical:DetectPHI'],
  resources: ['*'], // Comprehend Medical doesn't support resource-level scoping
}));


const extractFn = new lambda.Function(this, 'ExtractFn', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('lambda/extract'),
  timeout: cdk.Duration.minutes(2),
});

extractFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    'arn:aws:bedrock:us-east-1:860325090166:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0',
  ],
}));


const validateFn = new lambda.Function(this, 'ValidateFn', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('lambda/validate'),
  timeout: cdk.Duration.seconds(30),
});

const deidStep = new tasks.LambdaInvoke(this, 'De-identify', { lambdaFunction: deidFn, outputPath: '$.Payload' });
const extractStep = new tasks.LambdaInvoke(this, 'Extract & Summarize', { lambdaFunction: extractFn, outputPath: '$.Payload' });
const validateStep = new tasks.LambdaInvoke(this, 'Schema Validate', { lambdaFunction: validateFn, outputPath: '$.Payload' });

// This retry config is the whole point — it's what Argo Workflows didn't give you.
[deidStep, extractStep, validateStep].forEach(step => {
  step.addRetry({ errors: ['States.TaskFailed'], maxAttempts: 3, backoffRate: 2.0, interval: cdk.Duration.seconds(2) });
});

const definition = deidStep.next(extractStep).next(validateStep);

const stateMachine = new sfn.StateMachine(this, 'BatchPipeline', {
  definitionBody: sfn.DefinitionBody.fromChainable(definition),
  timeout: cdk.Duration.minutes(15),
  tracingEnabled: true, // X-Ray — you want to see exactly which step a document is on
});

const rule = new events.Rule(this, 'IngestRule', {
  eventPattern: {
    source: ['aws.s3'],
    detailType: ['Object Created'],
    detail: { bucket: { name: [this.rawBucket.bucketName] } },
  },
});
rule.addTarget(new targets.SfnStateMachine(stateMachine));

}
}