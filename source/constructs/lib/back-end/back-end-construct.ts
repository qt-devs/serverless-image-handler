// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontToApiGatewayToLambda } from "@aws-solutions-constructs/aws-cloudfront-apigateway-lambda";
import { ArnFormat, Aws, Duration, Lazy, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as api from "aws-cdk-lib/aws-apigateway";
import { LambdaRestApiProps, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  CfnDistribution,
  CfnOriginAccessControl,
  Distribution,
  DistributionProps,
  Function,
  FunctionEventType,
  IOrigin,
  KeyGroup,
  OriginRequestPolicy,
  OriginSslPolicy,
  PriceClass,
  PublicKey,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, FunctionUrl, FunctionUrlAuthType, InvokeMode, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Bucket, CfnBucketPolicy, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { addCfnSuppressRules } from "../../utils/utils";
import { SolutionConstructProps } from "../types";
import { S3OriginWithOACPatch } from "./s3OriginOAC";

export interface BackEndProps extends SolutionConstructProps {
  readonly solutionVersion: string;
  readonly solutionName: string;
  readonly secretsManagerPolicy: Policy;
  readonly logsBucket: IBucket;
  readonly uuid: string;
  readonly cloudFrontPriceClass: string;
  readonly viewerRequestFn: Function;
  readonly lambdaMemorySize: number;
  readonly tableNamePrefix: string;
  // /**
  //  * cloudfront public key for cloudfront sign url
  //  */
  // readonly publicKeyId: string;
}

export class BackEnd extends Construct {
  public domainName: string;
  public dnsRecord?: ARecord;
  public fnUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: BackEndProps) {
    super(scope, id);

    const imageHandlerLambdaFunctionRole = new Role(this, "ImagerFnRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      path: "/",
    });

    const imageHandlerLambdaFunctionRolePolicy = new Policy(this, "ImagerFnPolicy", {
      statements: [
        new PolicyStatement({
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [
            Stack.of(this).formatArn({
              service: "logs",
              resource: "log-group",
              resourceName: "/aws/lambda/*",
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new PolicyStatement({
          actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
          resources: [
            Stack.of(this).formatArn({
              service: "s3",
              resource: "*",
              region: "",
              account: "",
            }),
          ],
        }),
        new PolicyStatement({
          actions: ["dynamodb:GetItem"],
          resources: [
            Stack.of(this).formatArn({
              service: "dynamodb",
              resource: `table/${props.tableNamePrefix}-*`,
            }),
            Stack.of(this).formatArn({
              service: "dynamodb",
              resource: `table/${props.tableNamePrefix}-*/index/*`,
            }),
          ],
        }),
        new PolicyStatement({
          actions: ["rekognition:DetectFaces", "rekognition:DetectModerationLabels"],
          resources: ["*"],
        }),
      ],
    });

    addCfnSuppressRules(imageHandlerLambdaFunctionRolePolicy, [
      { id: "W12", reason: "rekognition:DetectFaces requires '*' resources." },
    ]);
    imageHandlerLambdaFunctionRole.attachInlinePolicy(imageHandlerLambdaFunctionRolePolicy);

    const memorySize = props.lambdaMemorySize;
    const imageHandlerLambdaFunction = new NodejsFunction(this, "ImagerFn", {
      description: `${props.solutionName} (${props.solutionVersion}): Performs image edits and manipulations`,
      memorySize,
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(29),
      role: imageHandlerLambdaFunctionRole,
      architecture: Architecture.ARM_64,
      entry: path.join(__dirname, "../../../image-handler/index.ts"),
      environment: {
        AUTO_WEBP: props.autoWebP,
        AUTO_AVIF: "Yes",
        CORS_ENABLED: props.corsEnabled,
        CORS_ORIGIN: props.corsOrigin,
        SOURCE_BUCKETS: props.sourceBuckets,
        REWRITE_MATCH_PATTERN: "",
        REWRITE_SUBSTITUTION: "",
        ENABLE_SIGNATURE: props.enableSignature,
        SECRETS_MANAGER: props.secretsManager,
        SECRET_KEY: props.secretsManagerKey,
        TABLE_NAME_PREFIX: props.tableNamePrefix,
        ENABLE_DEFAULT_FALLBACK_IMAGE: props.enableDefaultFallbackImage,
        DEFAULT_FALLBACK_IMAGE_BUCKET: props.fallbackImageS3Bucket,
        DEFAULT_FALLBACK_IMAGE_KEY: props.fallbackImageS3KeyBucket,
        VIPS_DISC_THRESHOLD: `${memorySize}m`,
      },
      bundling: {
        externalModules: ["sharp"],
        nodeModules: ["sharp"],
        minify: true,
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [
              `cd ${outputDir}`,
              "rm -rf node_modules/sharp && SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --cpu=arm64 --os=linux --libc=glibc sharp",
            ];
          },
        },
      },
    });

    const imageHandlerLogGroup = new LogGroup(this, "ImagerLogGroup", {
      logGroupName: `/aws/lambda/${imageHandlerLambdaFunction.functionName}`,
      retention: props.logRetentionPeriod as RetentionDays,
    });

    addCfnSuppressRules(imageHandlerLogGroup, [
      {
        id: "W84",
        reason: "CloudWatch log group is always encrypted by default.",
      },
    ]);

    const cachePolicy = new CachePolicy(this, "CachePolicy", {
      cachePolicyName: `ImageHandlerStack-${props.uuid}`,
      defaultTtl: Duration.days(1),
      minTtl: Duration.seconds(1),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: false, // IMPORTANT: keep this false, it improves cache hit ratio
      headerBehavior: CacheHeaderBehavior.allowList("origin", "accept"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature", "appId"),
    });

    const originRequestPolicy = new OriginRequestPolicy(this, "OriginRequestPolicy", {
      originRequestPolicyName: `ImageHandlerStack-${props.uuid}`,
      headerBehavior: CacheHeaderBehavior.allowList("origin", "accept"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature", "appId", "expires"),
    });

    // const apiGatewayRestApi = RestApi.fromRestApiId(
    //   this,
    //   "ApiGatewayRestApi",
    //   Lazy.string({
    //     produce: () => imageHandlerCloudFrontApiGatewayLambda.apiGateway.restApiId,
    //   })
    // );

    // const origin: IOrigin = new HttpOrigin(`${apiGatewayRestApi.restApiId}.execute-api.${Aws.REGION}.amazonaws.com`, {
    //   originPath: "/image",
    //   originSslProtocols: [OriginSslPolicy.TLS_V1_1, OriginSslPolicy.TLS_V1_2],
    // });

    this.fnUrl = imageHandlerLambdaFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
    });

    const origin: IOrigin = new FunctionUrlOrigin(this.fnUrl);

    const domain = props.domain ? `${props.subdomainPrefix}.${props.domain}` : "";
    const domainNames = domain ? [domain] : undefined;

    const certificate = Certificate.fromCertificateArn(this, "CertificateImport", props.certificateArn);

    // const bucket = Bucket.fromBucketName(this, "ImportBucket", props.sourceBuckets);
    // Create an Origin Access Control using Cfn construct
    // const oac = new CfnOriginAccessControl(this, "OAC", {
    //   originAccessControlConfig: {
    //     name: `ImageHandlerStack-BucketOAC-${props.uuid}`,
    //     originAccessControlOriginType: "s3",
    //     signingBehavior: "always",
    //     signingProtocol: "sigv4",
    //   },
    // });
    const oac = new CfnOriginAccessControl(this, "OAC", {
      originAccessControlConfig: {
        name: `ImageHandlerStack-FnUrlOAC-${props.uuid}`,
        originAccessControlOriginType: "lambda",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    const cloudFrontDistributionProps: DistributionProps = {
      comment: "Image Handler Distribution for Serverless Image Handler",
      defaultBehavior: {
        origin,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        originRequestPolicy,
        cachePolicy,
        functionAssociations: [
          {
            function: props.viewerRequestFn,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      // additionalBehaviors: {
      //   "/img/*": {
      //     origin: new S3OriginWithOACPatch(bucket, { oacId: oac.getAtt("id") }),
      //     allowedMethods: AllowedMethods.ALLOW_ALL,
      //     viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      //     originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      //     cachePolicy: CachePolicy.CACHING_DISABLED,
      //     trustedKeyGroups: [
      //       new KeyGroup(this, "KeyGroup", {
      //         items: [PublicKey.fromPublicKeyId(this, "KeyPairImport", props.publicKeyId)],
      //       }),
      //     ],
      //   },
      // },
      certificate,
      priceClass: props.cloudFrontPriceClass as PriceClass,
      enableLogging: true,
      logBucket: props.logsBucket,
      logFilePrefix: "api-cloudfront/",
      domainNames,
      errorResponses: [
        { httpStatus: 500, ttl: Duration.minutes(10) },
        { httpStatus: 501, ttl: Duration.minutes(10) },
        { httpStatus: 502, ttl: Duration.minutes(10) },
        { httpStatus: 503, ttl: Duration.minutes(10) },
        { httpStatus: 504, ttl: Duration.minutes(10) },
      ],
    };

    // const logGroupProps = {
    //   retention: props.logRetentionPeriod as RetentionDays,
    // };

    // const apiGatewayProps: LambdaRestApiProps = {
    //   handler: imageHandlerLambdaFunction,
    //   deployOptions: {
    //     stageName: "image",
    //   },
    //   binaryMediaTypes: ["*/*"],
    //   defaultMethodOptions: {
    //     authorizationType: api.AuthorizationType.NONE,
    //   },
    // };

    // const imageHandlerCloudFrontApiGatewayLambda = new CloudFrontToApiGatewayToLambda(this, "ImagerCFApiLambda", {
    //   existingLambdaObj: imageHandlerLambdaFunction,
    //   insertHttpSecurityHeaders: false,
    //   logGroupProps,
    //   cloudFrontDistributionProps,
    //   apiGatewayProps,
    // });

    const distribution = new Distribution(this, "CFDistribution", cloudFrontDistributionProps); //imageHandlerCloudFrontApiGatewayLambda.cloudFrontWebDistribution;

    if (props.domain) {
      const zone = HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domain,
      });
      const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));

      this.dnsRecord = new ARecord(this, "AAliasRecord", {
        recordName: props.subdomainPrefix,
        target,
        zone,
      });
      this.dnsRecord.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    // // Get reference to the underlying CloudFormation construct of the distribution
    const cfnDistribution = distribution.node.defaultChild as CfnDistribution;

    // // Override the OAC ID into the CloudFormation distribution CFN construct
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.OriginAccessControlId", oac.getAtt("Id"));

    // new CfnBucketPolicy(this, "UpdateBucketPolicyOAC", {
    //   bucket: bucket.bucketName,
    //   policyDocument: new PolicyDocument({
    //     statements: [
    //       new PolicyStatement({
    //         actions: ["s3:GetObject", "s3:PutObject"],
    //         resources: [bucket.arnForObjects("*")],
    //         principals: [
    //           new ServicePrincipal("cloudfront.amazonaws.com", {
    //             conditions: {
    //               ArnLike: {
    //                 // Note if you do Lambda Function and CloudFront Distribution in different stacks
    //                 // you'll most-likely end up with a circular dependency.
    //                 // Important, don't specify region as CloudFront needs to access the function from all regions
    //                 "aws:SourceArn": `arn:aws:cloudfront::${
    //                   Stack.of(this).account
    //                 }:distribution/${distribution.distributionId}`,
    //               },
    //             },
    //           }),
    //         ],
    //       }),
    //     ],
    //   }),
    // });
    imageHandlerLambdaFunction.addPermission("OACPermission", {
      action: "lambda:InvokeFunctionUrl",
      // Note if you do Lambda Function and CloudFront Distribution in different stacks
      // you'll most-likely end up with a circular dependency.
      // Important, don't specify region as CloudFront needs to access the function from all regions
      sourceArn: `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`,
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
    });

    // addCfnSuppressRules(imageHandlerCloudFrontApiGatewayLambda.apiGateway, [
    //   {
    //     id: "W59",
    //     reason:
    //       "AWS::ApiGateway::Method AuthorizationType is set to 'NONE' because API Gateway behind CloudFront does not support AWS_IAM authentication",
    //   },
    // ]);

    // imageHandlerCloudFrontApiGatewayLambda.apiGateway.node.tryRemoveChild("Endpoint"); // we don't need the RestApi endpoint in the outputs

    this.domainName = distribution.distributionDomainName;
  }
}
