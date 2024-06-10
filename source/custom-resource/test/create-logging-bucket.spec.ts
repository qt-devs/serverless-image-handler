// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { consoleErrorSpy, consoleInfoSpy, mockAwsEc2, mockAwsS3, mockContext } from "./mock";
import { CustomResourceActions, CustomResourceRequestTypes, CustomResourceRequest, CustomResourceError } from "../lib";
import { handler } from "../index";

describe("CREATE_LOGGING_BUCKET", () => {
  // Mock event data
  const event: CustomResourceRequest = {
    RequestType: CustomResourceRequestTypes.CREATE,
    ResponseURL: "/cfn-response",
    PhysicalResourceId: "mock-physical-id",
    StackId: "mock-stack-id",
    ServiceToken: "mock-service-token",
    RequestId: "mock-request-id",
    LogicalResourceId: "mock-logical-resource-id",
    ResourceType: "mock-resource-type",
    ResourceProperties: {
      CustomAction: CustomResourceActions.CREATE_LOGGING_BUCKET,
      BucketSuffix: `test-stack-test-region-01234567898`,
    },
  };

  it("Should return success and bucket name", async () => {
    mockAwsEc2.describeRegions.mockImplementationOnce(() =>
      Promise.resolve({ Regions: [{ RegionName: "mock-region-1" }] })
    );
    mockAwsS3.createBucket.mockImplementation(() => Promise.resolve());
    mockAwsS3.putBucketEncryption.mockImplementation(() => Promise.resolve());
    mockAwsS3.putBucketPolicy.mockImplementation(() => Promise.resolve());

    await handler(event, mockContext);

    expect.assertions(4);

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("The opt-in status of the 'mock-region-1' region is 'opted-in'")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Successfully created bucket 'serverless-image-handler-logs-[a-z0-9]{8}' in 'us-east-1' region/
      )
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Successfully enabled encryption on bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Successfully added policy added to bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
  });

  it("Should return failure when there is an error getting opt-in regions", async () => {
    mockAwsEc2.describeRegions.mockImplementation(() => Promise.reject(new Error("describeRegions failed")));

    const result = await handler(event, mockContext);

    expect.assertions(1);

    expect(result).toEqual({
      Status: "FAILED",
      Data: {
        Error: {
          Code: "CustomResourceError",
          Message: "describeRegions failed",
        },
      },
    });
  });

  it("Should return failure when there is an error creating the bucket", async () => {
    mockAwsEc2.describeRegions.mockImplementationOnce(() => Promise.resolve({ Regions: [] }));
    mockAwsS3.createBucket.mockImplementation(() =>
      Promise.reject(new CustomResourceError(null, "createBucket failed"))
    );

    const result = await handler(event, mockContext);

    expect.assertions(2);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Could not create bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
    expect(result).toEqual({
      Status: "FAILED",
      Data: {
        Error: { Code: "CustomResourceError", Message: "createBucket failed" },
      },
    });
  });

  it("Should return failure when there is an error enabling encryption on the created bucket", async () => {
    mockAwsEc2.describeRegions.mockImplementationOnce(() => Promise.resolve({ Regions: [] }));
    mockAwsS3.createBucket.mockImplementation(() => Promise.resolve());
    mockAwsS3.putBucketEncryption.mockImplementation(() =>
      Promise.reject(new CustomResourceError(null, "putBucketEncryption failed"))
    );

    const result = await handler(event, mockContext);

    expect.assertions(3);

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Successfully created bucket 'serverless-image-handler-logs-[a-z0-9]{8}' in 'us-east-1' region/
      )
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Failed to add encryption to bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
    expect(result).toEqual({
      Status: "FAILED",
      Data: {
        Error: {
          Code: "CustomResourceError",
          Message: "putBucketEncryption failed",
        },
      },
    });
  });

  it("Should return failure when there is an error applying a policy to the created bucket", async () => {
    mockAwsEc2.describeRegions.mockImplementationOnce(() => Promise.resolve({ Regions: [] }));
    mockAwsS3.createBucket.mockImplementation(() => Promise.resolve());
    mockAwsS3.putBucketEncryption.mockImplementation(() => Promise.resolve());
    mockAwsS3.putBucketPolicy.mockImplementation(() =>
      Promise.reject(new CustomResourceError(null, "putBucketPolicy failed"))
    );

    const result = await handler(event, mockContext);

    expect.assertions(4);

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Successfully created bucket 'serverless-image-handler-logs-[a-z0-9]{8}' in 'us-east-1' region/
      )
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Successfully enabled encryption on bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Failed to add policy to bucket 'serverless-image-handler-logs-[a-z0-9]{8}'/)
    );
    expect(result).toEqual({
      Status: "FAILED",
      Data: {
        Error: {
          Code: "CustomResourceError",
          Message: "putBucketPolicy failed",
        },
      },
    });
  });
});
