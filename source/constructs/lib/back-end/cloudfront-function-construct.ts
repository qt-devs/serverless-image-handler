import { Stack, ArnFormat, Aws, Duration } from "aws-cdk-lib";
import { Role, CompositePrincipal, ServicePrincipal, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import path from "path";
import fs from "fs";
import ts from "typescript";
import { addCfnSuppressRules } from "../../utils/utils";
import {
  Function,
  CfnKeyValueStore,
  FunctionRuntime,
  ImportSource,
  KeyValueStore,
  FunctionCode,
} from "aws-cdk-lib/aws-cloudfront";

type CfnFunctionProp = {
  secretsManagerValues: NodeJS.Dict<string>;
};
export class CfnFunctionConstruct extends Construct {
  viewerRequestFn: Function;

  constructor(scope: Construct, id: string, props: CfnFunctionProp) {
    super(scope, id);

    this.createViewerRequestFn(props);
  }

  createViewerRequestFn(props: CfnFunctionProp) {
    const viewerRequestSrcPath = path.join(__dirname, "../../../viewer-request/index.js");

    const source = fs.readFileSync(viewerRequestSrcPath, { encoding: "utf8" });

    const keyValueStore = new KeyValueStore(this, "ViewerRequestKeyValueStore", {
      keyValueStoreName: `${this.node.id}-ViewerRequestKeyValueStore`,
      source: ImportSource.fromInline(
        JSON.stringify({
          data: Object.keys(props.secretsManagerValues)
            .filter((key) => key === "HMAC_SECRET") // we only want 1 key
            .map((key) => ({
              key,
              value: props.secretsManagerValues[key],
            })),
        })
      ),
    });

    const functionCode = `const NODE_ENV="${process.env.NODE_ENV || "development"}";\nconst KVS_ID="${keyValueStore.keyValueStoreId}";\n${source.replace(/(?:[\r\n]|^)(\/\*.+?[\r\n]*\*\/)/gs, "")}`;

    const viewerReqLambdaName = "ViewerRequestFn";

    this.viewerRequestFn = new Function(this, viewerReqLambdaName, {
      functionName: `${this.node.id}-${viewerReqLambdaName}`,
      code: FunctionCode.fromInline(functionCode),
      runtime: FunctionRuntime.JS_2_0,
      keyValueStore,
      autoPublish: true,
    });
  }

  //// This is an example for creating lambda@edge for origin request functions
  // createOriginRequestFn() {
  // const viewerRequestFnRole = new Role(this, "ViewerRequestFnRole", {
  //   assumedBy: new CompositePrincipal(
  //     new ServicePrincipal("lambda.amazonaws.com"),
  //     new ServicePrincipal("edgelambda.amazonaws.com")
  //   ),
  //   path: "/",
  //   // managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AWSLambdaBasicExecutionRole")],
  // });

  // // props.secretsManagerPolicy.attachToRole(viewerRequestFnRole);
  // const viewerRequestFnRolePolicy = new Policy(this, "ViewerRequestFnRolePolicy", {
  //   statements: [
  //     new PolicyStatement({
  //       actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
  //       resources: [
  //         Stack.of(this).formatArn({
  //           service: "logs",
  //           resource: "log-group",
  //           resourceName: "/aws/lambda/*",
  //           arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  //         }),
  //       ],
  //     }),
  //     new PolicyStatement({
  //       actions: ["secretsmanager:GetSecretValue"],
  //       resources: [
  //         Stack.of(this).formatArn({
  //           partition: Aws.PARTITION,
  //           service: "secretsmanager",
  //           region: Aws.REGION,
  //           account: Aws.ACCOUNT_ID,
  //           resource: "secret",
  //           resourceName: `${props.secretsManager}*`,
  //           arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  //         }),
  //       ],
  //     }),
  //   ],
  // });
  // viewerRequestFnRole.attachInlinePolicy(viewerRequestFnRolePolicy);

  // const viewerRequestSrcPath = path.join(__dirname, "../../../viewer-request");
  // const viewerReqLambdaName = "ViewerRequestFn";
  // // NOTE: we are using regular lambda function creation method for this workaround for EdgeFunction since their bundling does not work when its nested
  // const viewerRequestFn = new CfnFunction(this, viewerReqLambdaName, {
  //   // entry: path.join(__dirname, "../../../viewer-request/index.ts"),
  //   functionCode: ``,
  //   role: viewerRequestFnRole,
  //   runtime: Runtime.NODEJS_LATEST,
  //   memorySize: 128,
  //   timeout: Duration.seconds(5),
  //   handler: "handler",
  //   code: Code.fromAsset(viewerRequestSrcPath, {
  //     bundling: {
  //       image: Runtime.NODEJS_LATEST.bundlingImage,
  //       command: [],
  //       local: {
  //         tryBundle(outputDir) {
  //           try {
  //             const source = fs.readFileSync(path.resolve(viewerRequestSrcPath, "index.ts"), { encoding: "utf8" });
  //             const output = ts.transpileModule(source, {
  //               compilerOptions: {
  //                 module: ts.ModuleKind.ESNext,
  //                 moduleResolution: ts.ModuleResolutionKind.NodeNext,
  //                 types: ["node"],
  //               },
  //             });
  //             fs.writeFileSync(
  //               path.resolve(outputDir, "index.js"),
  //               `process.env.NODE_ENV="${process.env.NODE_ENV || "development"}";\n${output.outputText}`
  //             );
  //             return true;
  //           } catch {
  //             return false;
  //           }
  //         },
  //       },
  //     },
  //   }),
  //   // bundling: {
  //   //   minify: true,
  //   //   commandHooks: {
  //   //     beforeBundling(inputDir: string, outputDir: string): string[] {
  //   //       return [];
  //   //     },
  //   //     beforeInstall(inputDir: string, outputDir: string): string[] {
  //   //       return [];
  //   //     },
  //   //     afterBundling(inputDir: string, outputDir: string): string[] {
  //   //       return [
  //   //         `cd ${outputDir}`,
  //   //         `printf '%s\\n%s\\n' "process.env.NODE_ENV='${process.env.NODE_ENV || "development"}';" "$(cat index.js)" >index.js`,
  //   //       ];
  //   //     },
  //   //   },
  //   // },
  //   // NOTE: Lambda@Edge does not allow env variables
  //   // environment: {
  //   // },
  // });

  // const viewerRequestFnLogGroup = new LogGroup(this, "ViewerRequestFnLogGroup", {
  //   logGroupName: `/aws/lambda/${viewerRequestFn.functionName}`,
  //   retention: props.logRetentionPeriod as RetentionDays,
  // });

  // addCfnSuppressRules(viewerRequestFnLogGroup, [
  //   {
  //     id: "W84",
  //     reason: "CloudWatch log group is always encrypted by default.",
  //   },
  // ]);
  // }
}
