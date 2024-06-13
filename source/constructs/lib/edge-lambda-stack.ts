import { CfnOutput, Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { experimental } from "aws-cdk-lib/aws-cloudfront";
import { ManagedPolicy, Policy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { spawnSync } from "child_process";
import { Construct } from "constructs";
import path from "path";

export interface EdgeLambdaStackProps {
  readonly secretsManagerPolicy: Policy;
}
export class EdgeLambdaStack extends Construct {
  viewerRequestFn: experimental.EdgeFunction;

  constructor(scope: Construct, id: string, props: EdgeLambdaStackProps) {
    super(scope, id);

    const viewerRequestFnRole = new Role(this, "ViewerRequestFnRole", {
      assumedBy: new ServicePrincipal("edgelambda.amazonaws.com"),
      path: "/",
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AWSLambdaBasicExecutionRole")],
    });
    props.secretsManagerPolicy.attachToRole(viewerRequestFnRole);

    const viewerReqLambdaName = "ViewerRequestFn";
    this.viewerRequestFn = new experimental.EdgeFunction(this, viewerReqLambdaName, {
      code: Code.fromAsset(path.join(__dirname, "../../viewer-request"), {
        bundling: {
          image: Runtime.NODEJS_20_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir: string) {
              try {
                spawnSync("npm -v");
              } catch {
                return false;
              }

              spawnSync(`npm run build && cp -a ./dist ${outputDir}`);
              return true;
            },
          },
        },
      }),
      runtime: Runtime.NODEJS_20_X,
      role: viewerRequestFnRole,
      memorySize: 128,
      timeout: Duration.seconds(5),
      handler: "handler",
      architecture: Architecture.ARM_64,
      // NOTE: Lambda@Edge does not allow env variables
      // environment: {
      // },
    });

    new CfnOutput(scope, `${viewerReqLambdaName}Arn`, {
      value: this.viewerRequestFn.functionArn,
    });
  }
}
