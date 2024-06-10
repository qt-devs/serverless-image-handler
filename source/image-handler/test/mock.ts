// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { SecretsManager } from "@aws-sdk/client-secrets-manager";
import { sdkStreamMixin } from "@smithy/util-stream";
import { mockClient } from "aws-sdk-client-mock";
import { Readable } from "stream";

// export const mockAwsS3 = {
//   headObject: jest.fn(),
//   copyObject: jest.fn(),
//   getObject: jest.fn(),
//   putObject: jest.fn(),
//   headBucket: jest.fn(),
//   createBucket: jest.fn(),
//   putBucketEncryption: jest.fn(),
//   putBucketPolicy: jest.fn(),
// };

// jest.mock("@aws-sdk/client-s3", () => ({
//   S3: jest.fn(() => ({ ...mockAwsS3 })),
// }));

// export const mockAwsSecretManager = {
//   getSecretValue: jest.fn(),
// };

// jest.mock("@aws-sdk/client-secrets-manager", () => ({
//   SecretsManager: jest.fn(() => ({ ...mockAwsSecretManager })),
// }));

// export const mockAwsRekognition = {
//   detectFaces: jest.fn(),
//   detectModerationLabels: jest.fn(),
// };

// jest.mock("@aws-sdk/client-rekognition", () => ({ SecretsManager: jest.fn(() => ({ ...mockAwsRekognition })) }));
export const mockAwsS3 = mockClient(S3Client);
export const mockRekognition = mockClient(RekognitionClient);
export const mockSecretsManager = mockClient(SecretsManager);

export const createStreamMixin = (data: string | Buffer) => {
  if (Buffer.isBuffer) {
    return sdkStreamMixin(Readable.from(data));
  }
  const stream = new Readable();
  stream.push(data);
  stream.push(null); // end of stream
  return sdkStreamMixin(stream);
};
export const consoleInfoSpy = jest.spyOn(console, "info");
