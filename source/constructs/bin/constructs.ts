// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { ServerlessImageHandlerStack } from "../lib/serverless-image-stack";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// CDK and default deployment
let synthesizer = new DefaultStackSynthesizer({
  generateBootstrapVersionRule: false,
});

// Solutions pipeline deployment
const {
  DIST_OUTPUT_BUCKET,
  SOLUTION_NAME,
  VERSION,
  NODE_ENV,
  AWS_ACCOUNT,
  PHX_DOMAIN,
  PHX_SUBDOMAIN_PREFIX,
  PHX_CERTIFICATE_ARN,
  PHX_S3_BUCKET,
  PHX_SECRETMANAGER_NAME,
  PHX_SECRETMANAGER_KEY = "hmacSecret",
  AWS_REGION = "us-east-1",
} = process.env;
if (DIST_OUTPUT_BUCKET && SOLUTION_NAME && VERSION)
  synthesizer = new DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
    fileAssetsBucketName: `${DIST_OUTPUT_BUCKET}-\${AWS::Region}`,
    bucketPrefix: `${SOLUTION_NAME}/${VERSION}/`,
  });

const env = NODE_ENV === "production" ? "PROD" : "DEV";
const app = new App();
const solutionDisplayName = `Image Handler - ${env}`;
const description = `(${app.node.tryGetContext("solutionId")}) - ${solutionDisplayName}. Version ${
  VERSION ?? app.node.tryGetContext("solutionVersion")
}`;

const secretsManagerClient = new SecretsManagerClient();

(async () => {
  const secretsManager = PHX_SECRETMANAGER_NAME ?? `${env}/phx/app-settings`.toLowerCase();
  const secretsManagerValues = await secretsManagerClient.send(
    new GetSecretValueCommand({
      SecretId: secretsManager,
    })
  );

  // eslint-disable-next-line no-new
  new ServerlessImageHandlerStack(app, `ImageHandlerStack-${env}`, {
    synthesizer,
    description,
    solutionId: app.node.tryGetContext("solutionId"),
    solutionVersion: app.node.tryGetContext("solutionVersion"),
    solutionName: app.node.tryGetContext("solutionName"),
    domain: PHX_DOMAIN || "",
    subdomainPrefix: PHX_SUBDOMAIN_PREFIX ?? "media",
    certificateArn: PHX_CERTIFICATE_ARN || "",
    sourceBuckets: PHX_S3_BUCKET ?? `phx-${env}-storage`.toLowerCase(),
    secretsManager,
    secretsManagerKey: PHX_SECRETMANAGER_KEY,
    secretsManagerValues: JSON.parse(secretsManagerValues.SecretString!),
    lambdaMemorySize: env === "PROD" ? 4096 : 1536,
    env: {
      region: AWS_REGION,
      account: AWS_ACCOUNT,
    },
  });
})();
