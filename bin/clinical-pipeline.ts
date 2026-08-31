#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ClinicalPipelineStack } from '../lib/clinical-pipeline-stack';

const app = new cdk.App();
new ClinicalPipelineStack(app, 'ClinicalPipelineStack');