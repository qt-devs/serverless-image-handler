import { Reference } from "aws-cdk-lib";
import {
  CfnOriginAccessControl,
  OriginBase,
  OriginBindConfig,
  OriginBindOptions,
  OriginProps,
} from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class S3OriginWithOACPatch extends S3Origin {
  private readonly oacId: Reference;

  constructor(bucket: IBucket, { oacId, ...props }: OriginProps & { oacId: Reference }) {
    super(bucket, props);
    this.oacId = oacId;
  }

  public bind(scope: Construct, options: OriginBindOptions): OriginBindConfig {
    const originConfig = super.bind(scope, options);

    if (!originConfig.originProperty) throw new Error("originProperty is required");

    return {
      ...originConfig,
      originProperty: {
        ...originConfig.originProperty,
        originAccessControlId: this.oacId.toString(), // Adds OAC to  S3 origin config
        s3OriginConfig: {
          originAccessIdentity: "", // removes OAI from S3 origin config
        },
      },
    };
  }
}
