// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontToApiGatewayToLambda } from "@aws-solutions-constructs/aws-cloudfront-apigateway-lambda";
import { ArnFormat, Aws, DockerImage, Duration, Lazy, RemovalPolicy, Stack } from "aws-cdk-lib";
import { LambdaRestApiProps, RestApi } from "aws-cdk-lib/aws-apigateway";
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  DistributionProps,
  FunctionEventType,
  IOrigin,
  LambdaEdgeEventType,
  OriginRequestPolicy,
  OriginSslPolicy,
  PriceClass,
  ViewerProtocolPolicy,
  experimental,
  CfnFunction,
  CfnKeyValueStore,
  Function,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import * as ts from "typescript";

import * as api from "aws-cdk-lib/aws-apigateway";
import { addCfnSuppressRules } from "../../utils/utils";
import { SolutionConstructProps } from "../types";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import fs from "fs";

export interface BackEndProps extends SolutionConstructProps {
  readonly solutionVersion: string;
  readonly solutionName: string;
  readonly secretsManagerPolicy: Policy;
  readonly logsBucket: IBucket;
  readonly uuid: string;
  readonly cloudFrontPriceClass: string;
  readonly viewerRequestFn: Function;
}

export class BackEnd extends Construct {
  public domainName: string;
  public dnsRecord?: ARecord;

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
          actions: ["rekognition:DetectFaces", "rekognition:DetectModerationLabels"],
          resources: ["*"],
        }),
      ],
    });

    addCfnSuppressRules(imageHandlerLambdaFunctionRolePolicy, [
      { id: "W12", reason: "rekognition:DetectFaces requires '*' resources." },
    ]);
    imageHandlerLambdaFunctionRole.attachInlinePolicy(imageHandlerLambdaFunctionRolePolicy);

    const memorySize = 1536;
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
        CORS_ENABLED: props.corsEnabled,
        CORS_ORIGIN: props.corsOrigin,
        SOURCE_BUCKETS: props.sourceBuckets,
        REWRITE_MATCH_PATTERN: "",
        REWRITE_SUBSTITUTION: "",
        ENABLE_SIGNATURE: props.enableSignature,
        SECRETS_MANAGER: props.secretsManager,
        SECRET_KEY: props.secretsManagerKey,
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
      enableAcceptEncodingGzip: false,
      headerBehavior: CacheHeaderBehavior.allowList("origin", "accept"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature"),
    });

    const originRequestPolicy = new OriginRequestPolicy(this, "OriginRequestPolicy", {
      originRequestPolicyName: `ImageHandlerStack-${props.uuid}`,
      headerBehavior: CacheHeaderBehavior.allowList("origin", "accept"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature"),
    });

    const apiGatewayRestApi = RestApi.fromRestApiId(
      this,
      "ApiGatewayRestApi",
      Lazy.string({
        produce: () => imageHandlerCloudFrontApiGatewayLambda.apiGateway.restApiId,
      })
    );

    const origin: IOrigin = new HttpOrigin(`${apiGatewayRestApi.restApiId}.execute-api.${Aws.REGION}.amazonaws.com`, {
      originPath: "/image",
      originSslProtocols: [OriginSslPolicy.TLS_V1_1, OriginSslPolicy.TLS_V1_2],
    });

    const domain = props.domain ? `${props.subdomainPrefix}.${props.domain}` : "";
    const domainNames = domain ? [domain] : undefined;

    const certificate = Certificate.fromCertificateArn(this, "CertificateImport", props.certificateArn);

    const cloudFrontDistributionProps: DistributionProps = {
      comment: "Image Handler Distribution for Serverless Image Handler",
      defaultBehavior: {
        origin,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy,
        cachePolicy,
        functionAssociations: [
          {
            function: props.viewerRequestFn,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
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

    const logGroupProps = {
      retention: props.logRetentionPeriod as RetentionDays,
    };

    const apiGatewayProps: LambdaRestApiProps = {
      handler: imageHandlerLambdaFunction,
      deployOptions: {
        stageName: "image",
      },
      binaryMediaTypes: ["*/*"],
      defaultMethodOptions: {
        authorizationType: api.AuthorizationType.NONE,
      },
    };

    const imageHandlerCloudFrontApiGatewayLambda = new CloudFrontToApiGatewayToLambda(this, "ImagerCFApiLambda", {
      existingLambdaObj: imageHandlerLambdaFunction,
      insertHttpSecurityHeaders: false,
      logGroupProps,
      cloudFrontDistributionProps,
      apiGatewayProps,
    });
    if (props.domain) {
      const zone = HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domain,
      });
      const target = RecordTarget.fromAlias(
        new CloudFrontTarget(imageHandlerCloudFrontApiGatewayLambda.cloudFrontWebDistribution)
      );

      this.dnsRecord = new ARecord(this, "AAliasRecord", {
        recordName: props.subdomainPrefix,
        target,
        zone,
      });
      this.dnsRecord.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    addCfnSuppressRules(imageHandlerCloudFrontApiGatewayLambda.apiGateway, [
      {
        id: "W59",
        reason:
          "AWS::ApiGateway::Method AuthorizationType is set to 'NONE' because API Gateway behind CloudFront does not support AWS_IAM authentication",
      },
    ]);

    imageHandlerCloudFrontApiGatewayLambda.apiGateway.node.tryRemoveChild("Endpoint"); // we don't need the RestApi endpoint in the outputs

    this.domainName = imageHandlerCloudFrontApiGatewayLambda.cloudFrontWebDistribution.distributionDomainName;
  }
}
